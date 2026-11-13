/**
 * Wishlist (saved products) — public.wishlist_items, one row per
 * (user_id, product_id). The database fills user_id from auth.uid(), lets a
 * user read/delete only their own rows, accepts only active products of
 * published stores and caps the list at 200 rows. Guests have no wishlist.
 */
import { z } from "zod";
import type { Product } from "@/data/catalog";
import type { ProductRow } from "@/data/db";
import { supabase } from "@/lib/supabase";
import { hostConfig, mainSiteUrl, type HostConfig } from "@/lib/host";
import { toProduct } from "./catalog";

export const WISHLIST_MAX = 200;

export const productIdSchema = z.string().uuid();

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
/** Thrown before any call when nobody is signed in. */
export class NotSignedInError extends Error {
  readonly code = "not_signed_in";
  constructor() {
    super("Sign in to save products.");
    this.name = "NotSignedInError";
  }
}

export type WishlistErrorKind =
  "notSignedIn" | "full" | "unavailable" | "notReady" | "network" | "invalid";

/** What went wrong, for a message in plain words (null = show the database's own text). */
export function wishlistErrorKind(error: unknown): WishlistErrorKind | null {
  const e = (error && typeof error === "object" ? error : {}) as {
    code?: unknown;
    message?: unknown;
    name?: unknown;
  };
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";
  if (error instanceof NotSignedInError || code === "not_signed_in") return "notSignedIn";
  if (/wishlist is full/i.test(message)) return "full";
  if (code === "PGRST205" || code === "42P01") return "notReady";
  // RLS refused the insert: the product is not active, or its store is not published.
  if (code === "42501" || /row-level security|permission denied/i.test(message))
    return "unavailable";
  if (code === "23503") return "unavailable"; // product no longer exists
  if (code === "22P02" || error instanceof z.ZodError) return "invalid";
  if (/failed to fetch|networkerror|load failed/i.test(message)) return "network";
  return null;
}

// ---------------------------------------------------------------------------
// Rows → items
// ---------------------------------------------------------------------------
type WishlistProduct = Pick<
  ProductRow,
  | "id"
  | "store_id"
  | "category_id"
  | "title"
  | "slug"
  | "description"
  | "price"
  | "compare_price"
  | "stock"
  | "featured_image"
  | "status"
  | "created_at"
> & {
  stores: { slug: string; name: string; status: string | null } | null;
  categories: { slug: string } | null;
  product_images: { image_url: string; sort_order: number | null }[] | null;
};

export interface WishlistRow {
  product_id: string;
  created_at: string;
  /** null when the product was deleted or is hidden from this user by RLS. */
  products: WishlistProduct | null;
}

export interface WishlistItem {
  productId: string;
  savedAt: string;
  product: Product;
  storeName: string;
}

const WISHLIST_SELECT =
  "product_id, created_at, products(id, store_id, category_id, title, slug, description, price," +
  " compare_price, stock, featured_image, status, created_at, stores(slug, name, status)," +
  " categories(slug), product_images(image_url, sort_order))";

/**
 * Only products people can still buy: deleted, non-active products and
 * products of stores that are no longer published are left out (their rows
 * stay in the database, they are simply not shown).
 */
export function toWishlistItems(rows: WishlistRow[]): WishlistItem[] {
  return rows.flatMap((row) => {
    const p = row.products;
    if (!p || p.status !== "active" || p.stores?.status !== "published") return [];
    return [
      {
        productId: row.product_id,
        savedAt: row.created_at,
        product: toProduct(p as Parameters<typeof toProduct>[0]),
        storeName: p.stores.name,
      },
    ];
  });
}

async function signedInUserId(): Promise<string> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new NotSignedInError();
  return session.user.id;
}

export const wishlistService = {
  /** Saved products that can still be shown, newest first. */
  list: async (): Promise<WishlistItem[]> => {
    const userId = await signedInUserId();
    const { data, error } = await supabase
      .from("wishlist_items")
      .select(WISHLIST_SELECT)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return toWishlistItems((data ?? []) as unknown as WishlistRow[]);
  },

  /** Ids of every saved product (for the hearts), including unavailable ones. */
  ids: async (): Promise<string[]> => {
    const userId = await signedInUserId();
    const { data, error } = await supabase
      .from("wishlist_items")
      .select("product_id")
      .eq("user_id", userId);
    if (error) throw error;
    return ((data ?? []) as { product_id: string }[]).map((r) => r.product_id);
  },

  /** Number of rows the database holds for this user (the 200 limit counts these). */
  count: async (): Promise<number> => {
    const userId = await signedInUserId();
    const { count, error } = await supabase
      .from("wishlist_items")
      .select("product_id", { count: "exact", head: true })
      .eq("user_id", userId);
    if (error) throw error;
    return count ?? 0;
  },

  /** Saves a product. Sends ONLY product_id; already saved counts as success. */
  add: async (productId: string): Promise<void> => {
    const product_id = productIdSchema.parse(productId);
    await signedInUserId();
    const { error } = await supabase.from("wishlist_items").insert({ product_id });
    if (error && error.code !== "23505") throw error;
  },

  /** Removes a product (removing one that isn't saved is not an error). */
  remove: async (productId: string): Promise<void> => {
    const product_id = productIdSchema.parse(productId);
    const userId = await signedInUserId();
    const { error } = await supabase
      .from("wishlist_items")
      .delete()
      .eq("user_id", userId)
      .eq("product_id", product_id);
    if (error) throw error;
  },
};

// ---------------------------------------------------------------------------
// "Save after sign-in" (a guest tapped a heart)
// ---------------------------------------------------------------------------
const PENDING_KEY = "saloree.wishlist-pending";
/** A pending save older than this is dropped (the guest gave up). */
export const PENDING_MAX_AGE_MS = 30 * 60 * 1000;
/** Query parameter that carries the pending save across domains (store subdomain → main site). */
export const SAVE_PARAM = "saveToWishlist";

function tabStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function rememberPendingSave(productId: string, now = Date.now()) {
  if (!productIdSchema.safeParse(productId).success) return;
  try {
    tabStorage()?.setItem(PENDING_KEY, JSON.stringify({ productId, at: now }));
  } catch {
    // Storage blocked: the person saves it again after signing in.
  }
}

/** Reads and clears the pending save (one use only). */
export function takePendingSave(now = Date.now()): string | null {
  let raw: string | null = null;
  try {
    const s = tabStorage();
    raw = s?.getItem(PENDING_KEY) ?? null;
    s?.removeItem(PENDING_KEY);
  } catch {
    return null;
  }
  return parsePendingSave(raw, now);
}

export function parsePendingSave(raw: string | null, now = Date.now()): string | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return null;
    const { productId, at } = v as { productId?: unknown; at?: unknown };
    if (typeof at !== "number" || now - at > PENDING_MAX_AGE_MS || at > now + 60_000) return null;
    return productIdSchema.safeParse(productId).success ? (productId as string) : null;
  } catch {
    return null;
  }
}

/**
 * From a store subdomain (no session there): the main site's sign-in, which
 * returns to the same product on the main site and saves it.
 */
export function mainSiteSaveSignInUrl(productId: string, cfg: HostConfig = hostConfig()): string {
  const back = `/product/${encodeURIComponent(productId)}?${SAVE_PARAM}=${encodeURIComponent(productId)}`;
  return mainSiteUrl(`/login?redirect=${encodeURIComponent(back)}`, cfg);
}

const BASE = "https://saloree.invalid"; // relative paths (router hrefs) resolve against this

/** A product id carried in the URL (`?saveToWishlist=`), or null. Accepts a path or a full URL. */
export function pendingSaveFromUrl(href: string): string | null {
  try {
    const id = new URL(href, BASE).searchParams.get(SAVE_PARAM);
    return id && productIdSchema.safeParse(id).success ? id : null;
  } catch {
    return null;
  }
}

/** The same address without `?saveToWishlist=` (path + query + hash). */
export function withoutSaveParam(href: string): string {
  const url = new URL(href, BASE);
  url.searchParams.delete(SAVE_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}
