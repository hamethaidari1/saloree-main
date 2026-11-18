import { z } from "zod";
import { brandSchema, colorsSchema, sizesSchema } from "@/lib/product-options";
import type { CategoryRow, OrderItemRow, OrderRow, ProductRow, StoreRow } from "@/data/db";
import { RESERVED_STORE_SLUGS } from "@/lib/host";
import { supabase } from "@/lib/supabase";
import { expectRows, friendlyError, NotPermittedError } from "./errors";

// ---------------------------------------------------------------------------
// Constants & validation
// ---------------------------------------------------------------------------
export const ORDER_STATUSES = [
  "pending",
  "processing",
  "shipped",
  "delivered",
  "cancelled",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export const PRODUCT_STATUSES = ["active", "draft"] as const;

const BUCKETS = {
  logo: "store-logos",
  banner: "store-banners",
  product: "product-images",
} as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const IMAGE_ACCEPT = IMAGE_TYPES.join(",");
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugify(text: string) {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

// Schemas must be idempotent: forms parse once, and the service parses the
// already-parsed values again, so every field must accept its own output.
// Empty optional values are always stored as null.
const isBlank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");

/** "" / whitespace / null / undefined → null; otherwise a trimmed string. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

/** Blank → null; otherwise a number. */
const optionalNumber = (schema: z.ZodNumber) =>
  z.preprocess((v) => (isBlank(v) ? null : v), z.coerce.number().pipe(schema).nullable());

/** Blank → "required" error (z.coerce alone would turn "" into 0). */
const requiredNumber = (schema: z.ZodNumber, message: string) =>
  z.preprocess(
    (v) => (isBlank(v) ? undefined : v),
    z.coerce.number({ required_error: message, invalid_type_error: message }).pipe(schema),
  );

/**
 * Store address = subdomain, so DNS-safe: a-z 0-9 "-", 3–63 chars, no
 * leading/trailing dash, not reserved. The database enforces the same rules.
 */
export const storeSlugSchema = z
  .string({ required_error: "Choose a store address." })
  .trim()
  .toLowerCase()
  .superRefine((s, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (!/^[a-z0-9-]*$/.test(s))
      return fail("Use only lowercase letters (a–z), numbers and dashes.");
    if (s.startsWith("-") || s.endsWith("-"))
      return fail("The address can't start or end with a dash.");
    if (s.length < 3) return fail("Use at least 3 characters.");
    if (s.length > 63) return fail("Use at most 63 characters.");
    if ((RESERVED_STORE_SLUGS as readonly string[]).includes(s))
      return fail("That address is reserved. Choose another.");
  });

/** A store address suggestion from its name (the seller can edit it). */
export const toStoreSlug = (name: string) => slugify(name).slice(0, 63).replace(/-+$/, "");

/** Store save errors, including the database's unique and reserved-name checks. */
export const storeError = (e: unknown) => {
  // The store-limit trigger's own words, whatever error code it uses
  // ("Store limit reached: you can have N store(s). Contact Saloree support to open more.").
  const message = (e as { message?: unknown } | null)?.message;
  if (typeof message === "string" && /store limit reached/i.test(message)) return message;
  return friendlyError(e, {
    "23505": "That store address is already taken. Choose another.",
    "23514": "That store address isn't allowed (it may be reserved). Choose another.",
  });
};

export const storeInputSchema = z.object({
  name: z.string().trim().min(2, "Store name needs at least 2 characters.").max(80),
  slug: storeSlugSchema,
  description: optionalText(1000),
  category: optionalText(80),
  location: optionalText(160),
});
export type StoreInput = z.input<typeof storeInputSchema>;

export const productInputSchema = z
  .object({
    title: z.string().trim().min(2, "Title needs at least 2 characters.").max(200),
    slug: z
      .string()
      .trim()
      .max(90)
      .regex(SLUG, "Use lowercase letters, numbers and single hyphens."),
    description: optionalText(5000),
    price: requiredNumber(
      z.number().positive("Price must be greater than 0.").max(1_000_000),
      "Enter a price.",
    ),
    compare_price: optionalNumber(
      z.number().positive("Compare-at price must be greater than 0.").max(1_000_000),
    ),
    stock: requiredNumber(
      z
        .number()
        .int("Stock must be a whole number.")
        .min(0, "Stock can't be negative.")
        .max(1_000_000),
      "Enter the stock quantity.",
    ),
    category_id: z.string().uuid("Choose a category."),
    status: z.enum(PRODUCT_STATUSES),
    brand: brandSchema,
    colors: colorsSchema,
    sizes: sizesSchema,
  })
  .refine((v) => v.compare_price == null || v.compare_price > v.price, {
    path: ["compare_price"],
    message: "Compare-at price must be higher than the price.",
  });
/** Validated product values (numbers already coerced). */
export type ProductInput = z.output<typeof productInputSchema>;

export function validateImage(file: File) {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error(`${file.name}: use PNG, JPG, WebP or GIF.`);
  if (file.size > MAX_IMAGE_BYTES) throw new Error(`${file.name}: images must be 5 MB or smaller.`);
}

export { friendlyError };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function requireUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new NotPermittedError("Please sign in again.");
  return user.id;
}

/**
 * Uploads to `{bucket}/{user_id}/{...folders}/{uuid}.{ext}` — the first
 * folder is always the uploader's id so storage policies can lock to it.
 */
async function uploadImage(
  bucket: (typeof BUCKETS)[keyof typeof BUCKETS],
  userId: string,
  folders: string[],
  file: File,
) {
  validateImage(file);
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = [userId, ...folders, `${crypto.randomUUID()}.${ext || "jpg"}`].join("/");
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** Best-effort removal; only touches files inside the caller's own folder. */
async function removeImages(bucket: string, userId: string, urls: (string | null | undefined)[]) {
  const marker = `/object/public/${bucket}/`;
  const paths = urls
    .map((u) => (u && u.includes(marker) ? decodeURIComponent(u.split(marker)[1] ?? "") : ""))
    .filter((p) => p.startsWith(`${userId}/`));
  if (paths.length) await supabase.storage.from(bucket).remove(paths);
}

/**
 * Picks `base`, `base-2`, `base-3`… among the slugs this user can see. RLS
 * hides other sellers' drafts, so callers also retry on a unique violation.
 */
async function availableSlug(table: "products", base: string, excludeId?: string) {
  const root = base || "item";
  const { data, error } = await supabase.from(table).select("id, slug").like("slug", `${root}%`);
  if (error) throw error;
  const taken = new Set((data ?? []).filter((r) => r.id !== excludeId).map((r) => r.slug));
  if (!taken.has(root)) return root;
  for (let i = 2; ; i++) if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
}

async function withSlugRetry<T>(slug: string, run: (slug: string) => Promise<T>): Promise<T> {
  try {
    return await run(slug);
  } catch (e) {
    if ((e as { code?: string }).code !== "23505") throw e;
    return run(`${slug}-${crypto.randomUUID().slice(0, 6)}`);
  }
}

/** An update/delete blocked by RLS returns no error and zero rows — treat that as a failure. */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ProductImageRow {
  id: string;
  product_id: string;
  image_url: string;
  sort_order: number | null;
}
export type SellerProduct = ProductRow & { product_images: ProductImageRow[] };
export type SellerOrder = OrderRow & { order_items: OrderItemRow[] };
/** Images in the product form: already-saved URLs and files waiting to upload. */
export type ImageItem =
  | { kind: "existing"; key: string; url: string }
  | { kind: "new"; key: string; file: File; preview: string };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export const sellerService = {
  /**
   * Uploads a store logo or banner to the seller's own folder
   * ({user_id}/logos/… or {user_id}/banners/…) and returns its public URL.
   * Used by the Customize editor before `save_store_appearance`.
   */
  uploadStoreImage: async (kind: "logo" | "banner", file: File): Promise<string> => {
    const userId = await requireUserId();
    return kind === "logo"
      ? uploadImage(BUCKETS.logo, userId, ["logos"], file)
      : uploadImage(BUCKETS.banner, userId, ["banners"], file);
  },

  getCategories: async (): Promise<CategoryRow[]> => {
    const { data, error } = await supabase
      .from("categories")
      .select("id, name, slug, created_at")
      .order("name");
    if (error) throw error;
    return data as CategoryRow[];
  },

  /** Every store the signed-in user owns, including drafts. */
  getMyStores: async (): Promise<StoreRow[]> => {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("stores")
      .select("*")
      .eq("owner_id", userId)
      .order("created_at");
    if (error) throw error;
    return data as StoreRow[];
  },

  createStore: async (
    input: StoreInput,
    files: { logo?: File | null; banner?: File | null },
  ): Promise<StoreRow> => {
    const userId = await requireUserId();
    const values = storeInputSchema.parse(input);
    const uploaded: { bucket: string; url: string }[] = [];
    try {
      const logo_url = files.logo
        ? await uploadImage(BUCKETS.logo, userId, ["logos"], files.logo)
        : null;
      if (logo_url) uploaded.push({ bucket: BUCKETS.logo, url: logo_url });
      const banner_url = files.banner
        ? await uploadImage(BUCKETS.banner, userId, ["banners"], files.banner)
        : null;
      if (banner_url) uploaded.push({ bucket: BUCKETS.banner, url: banner_url });
      // The address is the seller's choice; a taken one is reported (23505), not renamed.
      const { data, error } = await supabase
        .from("stores")
        .insert({ ...values, logo_url, banner_url, owner_id: userId, status: "draft" })
        .select("*")
        .single();
      if (error) throw error;
      return data as StoreRow;
    } catch (e) {
      for (const u of uploaded) await removeImages(u.bucket, userId, [u.url]).catch(() => {});
      throw e;
    }
  },

  /**
   * Records which Seller Agreement version (its "updated" date) the owner
   * accepted. Only the version is sent: a database trigger sets
   * stores.seller_agreement_accepted_at, so the browser's clock is never
   * trusted. Until the column exists this fails with the database's own error.
   */
  recordSellerAgreement: async (storeId: string, version: string) => {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from("stores")
      .update({ seller_agreement_version: version })
      .eq("id", storeId)
      .eq("owner_id", userId)
      .select("id");
    if (error) throw error;
    expectRows(data, "store");
  },

  /** Edits store info; status and owner are not editable here. */
  updateStore: async (
    store: StoreRow,
    input: StoreInput,
    files: { logo?: File | null; banner?: File | null },
  ): Promise<StoreRow> => {
    const userId = await requireUserId();
    const values = storeInputSchema.parse(input);
    const logo_url = files.logo
      ? await uploadImage(BUCKETS.logo, userId, ["logos"], files.logo)
      : store.logo_url;
    const banner_url = files.banner
      ? await uploadImage(BUCKETS.banner, userId, ["banners"], files.banner)
      : store.banner_url;
    try {
      const { data, error } = await supabase
        .from("stores")
        .update({ ...values, logo_url, banner_url, updated_at: new Date().toISOString() })
        .eq("id", store.id)
        .eq("owner_id", userId)
        .select("*");
      if (error) throw error;
      const updated = expectRows(data as StoreRow[], "store");
      if (files.logo) await removeImages(BUCKETS.logo, userId, [store.logo_url]).catch(() => {});
      if (files.banner)
        await removeImages(BUCKETS.banner, userId, [store.banner_url]).catch(() => {});
      return updated;
    } catch (e) {
      if (files.logo) await removeImages(BUCKETS.logo, userId, [logo_url]).catch(() => {});
      if (files.banner) await removeImages(BUCKETS.banner, userId, [banner_url]).catch(() => {});
      throw e;
    }
  },

  getStoreProducts: async (storeId: string): Promise<SellerProduct[]> => {
    const { data, error } = await supabase
      .from("products")
      .select("*, product_images(id, product_id, image_url, sort_order)")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as SellerProduct[]).map((p) => ({
      ...p,
      product_images: [...(p.product_images ?? [])].sort(
        (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
      ),
    }));
  },

  /** Creates (no `existing`) or updates a product; the first image becomes featured_image. */
  saveProduct: async (
    storeId: string,
    input: ProductInput,
    images: ImageItem[],
    existing?: SellerProduct,
  ): Promise<void> => {
    const userId = await requireUserId();
    const values = productInputSchema.parse(input);
    for (const img of images) if (img.kind === "new") validateImage(img.file);
    const productId = existing?.id ?? crypto.randomUUID();
    const folders = ["products", storeId, productId];

    const newUrls: string[] = [];
    try {
      const urls: string[] = [];
      for (const img of images) {
        if (img.kind === "existing") urls.push(img.url);
        else {
          const url = await uploadImage(BUCKETS.product, userId, folders, img.file);
          newUrls.push(url);
          urls.push(url);
        }
      }
      const slug = await availableSlug("products", values.slug, existing?.id);
      await withSlugRetry(slug, async (s) => {
        const row = { ...values, slug: s, featured_image: urls[0] ?? null };
        if (existing) {
          const { data, error } = await supabase
            .from("products")
            .update(row)
            .eq("id", existing.id)
            .eq("store_id", storeId)
            .select("id");
          if (error) throw error;
          expectRows(data, "product");
        } else {
          const { error } = await supabase
            .from("products")
            .insert({ ...row, id: productId, store_id: storeId });
          if (error) throw error;
        }
      });

      // Replace the image list so its order matches the form.
      if (existing?.product_images.length) {
        const { error } = await supabase
          .from("product_images")
          .delete()
          .eq("product_id", productId);
        if (error) throw error;
      }
      if (urls.length) {
        const { error } = await supabase
          .from("product_images")
          .insert(
            urls.map((image_url, i) => ({ product_id: productId, image_url, sort_order: i })),
          );
        if (error) throw error;
      }
    } catch (e) {
      await removeImages(BUCKETS.product, userId, newUrls).catch(() => {});
      throw e;
    }

    if (existing) {
      const kept = new Set(images.flatMap((i) => (i.kind === "existing" ? [i.url] : [])));
      const removed = [
        existing.featured_image,
        ...existing.product_images.map((i) => i.image_url),
      ].filter((u): u is string => !!u && !kept.has(u));
      await removeImages(BUCKETS.product, userId, removed).catch(() => {});
    }
  },

  deleteProduct: async (product: SellerProduct): Promise<void> => {
    const userId = await requireUserId();
    const { error: imgError } = await supabase
      .from("product_images")
      .delete()
      .eq("product_id", product.id);
    if (imgError) throw imgError;
    const { data, error } = await supabase
      .from("products")
      .delete()
      .eq("id", product.id)
      .select("id");
    if (error) throw error;
    expectRows(data, "product");
    await removeImages(BUCKETS.product, userId, [
      product.featured_image,
      ...product.product_images.map((i) => i.image_url),
    ]).catch(() => {});
  },

  getOrders: async (storeIds: string[]): Promise<SellerOrder[]> => {
    if (!storeIds.length) return [];
    const { data, error } = await supabase
      .from("orders")
      .select("*, order_items(*)")
      .in("store_id", storeIds)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data as SellerOrder[];
  },

  /** Sends only `status`; the DB must also stop sellers changing other columns (see SQL draft). */
  updateOrderStatus: async (orderId: string, status: OrderStatus): Promise<void> => {
    const { data, error } = await supabase
      .from("orders")
      .update({ status })
      .eq("id", orderId)
      .select("id");
    if (error) throw error;
    expectRows(data, "order");
  },
};
