/**
 * Content staff (Fazil, content_admin) — and admins. Everything runs as the
 * signed-in user; the database decides what is allowed:
 *  - stores: read all, change ONLY `status` of stores he doesn't own;
 *  - products: read all, change ONLY `status`;
 *  - categories and the homepage tables: full management;
 *  - site_settings: everything EXCEPT `footer_settings` (company details);
 *  - profiles: only store owners (name, email).
 */
import { z } from "zod";
import type { ProductRow, StoreRow } from "@/data/db";
import { supabase } from "@/lib/supabase";
import { safeHttpsUrl } from "@/lib/tracking";
import { safeFooterUrl } from "./site";
import { count, currentUserId, head, type AdminStore } from "./admin";
import { expectRows } from "./errors";

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
export interface MarketplaceOverview {
  storesWaiting: number;
  storesPublished: number;
  productsActive: number;
  productsDraft: number;
  sellers: number;
  categories: number;
}

// ---------------------------------------------------------------------------
// Sellers = store owners, grouped from the store list.
// ---------------------------------------------------------------------------
export interface SellerSummary {
  ownerId: string;
  name: string | null;
  email: string | null;
  stores: Pick<AdminStore, "id" | "name" | "slug" | "status" | "productCount">[];
  productCount: number;
}

export function groupSellers(stores: AdminStore[]): SellerSummary[] {
  const byOwner = new Map<string, SellerSummary>();
  for (const s of stores) {
    const seller = byOwner.get(s.owner_id) ?? {
      ownerId: s.owner_id,
      name: s.ownerName,
      email: s.ownerEmail,
      stores: [],
      productCount: 0,
    };
    seller.stores.push({
      id: s.id,
      name: s.name,
      slug: s.slug,
      status: s.status,
      productCount: s.productCount,
    });
    seller.productCount += s.productCount;
    byOwner.set(s.owner_id, seller);
  }
  return [...byOwner.values()].sort((a, b) =>
    (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""),
  );
}

// ---------------------------------------------------------------------------
// Homepage content tables
// ---------------------------------------------------------------------------
const text = (max: number) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string().max(max, `Use at most ${max} characters.`),
  );
const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), text(max).nullable());
const httpsImage = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z
    .string()
    .min(1, "Add an image.")
    .refine((v) => !!safeHttpsUrl(v), "The image address must start with https://"),
);
const optionalHttpsImage = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z
    .string()
    .refine((v) => !!safeHttpsUrl(v), "The image address must start with https://")
    .nullable(),
);
/** A link: an internal path ("/stores") or an https:// address. */
const link = z.preprocess(
  (v) => (typeof v === "string" ? v.trim() : v),
  z
    .string()
    .min(1, "Add a link.")
    .refine((v) => !!safeFooterUrl(v), "Use a path like /stores or an https:// address."),
);
const optionalLink = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z
    .string()
    .refine((v) => !!safeFooterUrl(v), "Use a path like /stores or an https:// address.")
    .nullable(),
);
const order = z.coerce
  .number({ invalid_type_error: "Enter a number." })
  .int("Use a whole number.")
  .min(0, "Use 0 or more.")
  .max(9999);

export const CONTENT_SCHEMAS = {
  hero_slides: z.object({
    image_url: httpsImage,
    alt_text: text(200).pipe(z.string().min(3, "Describe the image for screen readers.")),
    display_order: order,
    is_active: z.boolean(),
  }),
  homepage_sections: z.object({
    section_key: z.preprocess(
      (v) => (typeof v === "string" ? v.trim().toLowerCase() : v),
      z.string().regex(/^[a-z0-9_-]{2,40}$/, "Use 2–40 lowercase letters, numbers, - or _."),
    ),
    title: optionalText(120),
    display_order: order,
    is_visible: z.boolean(),
  }),
  promo_banners: z.object({
    image_url: optionalHttpsImage,
    title: optionalText(120),
    subtitle: optionalText(200),
    button_text: optionalText(40),
    button_link: optionalLink,
    display_order: order,
    is_active: z.boolean(),
  }),
  footer_links: z.object({
    category: text(40).pipe(z.string().min(2, "Name the column (e.g. Help).")),
    label: text(60).pipe(z.string().min(2, "Add a label.")),
    url: link,
    display_order: order,
    is_active: z.boolean(),
  }),
} as const;

export type ContentTable = keyof typeof CONTENT_SCHEMAS;
export type ContentInput<T extends ContentTable> = z.output<(typeof CONTENT_SCHEMAS)[T]>;
export type ContentRow<T extends ContentTable> = ContentInput<T> & {
  id: string;
  created_at: string;
};

export const CONTENT_TABLES = Object.keys(CONTENT_SCHEMAS) as ContentTable[];

// Image uploads go into the uploader's own folder (same storage rules as sellers).
export const CONTENT_IMAGE_BUCKET = "store-banners";
export const CONTENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Site texts (site_settings without footer_settings)
// ---------------------------------------------------------------------------
const httpsOnly = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? null : v),
  z
    .string()
    .trim()
    .refine((v) => !!safeHttpsUrl(v), "Social links must start with https://")
    .nullable(),
);

export const siteTextsSchema = z
  .object({
    hero_title: optionalText(120),
    hero_subtitle: optionalText(240),
    hero_button_text: optionalText(40),
    hero_button_link: optionalLink,
    secondary_button_text: optionalText(40),
    secondary_button_link: optionalLink,
    footer_description: optionalText(300),
    copyright_text: optionalText(120),
    facebook_url: httpsOnly,
    instagram_url: httpsOnly,
    twitter_url: httpsOnly,
  })
  .strict(); // never accepts footer_settings or any other column
export type SiteTexts = z.output<typeof siteTextsSchema>;
export const SITE_TEXT_FIELDS = Object.keys(siteTextsSchema.shape) as (keyof SiteTexts)[];

export const marketplaceService = {
  getOverview: async (): Promise<MarketplaceOverview> => {
    const [storesWaiting, storesPublished, productsActive, productsDraft, categories, owners] =
      await Promise.all([
        count(supabase.from("stores").select("id", head).eq("status", "draft")),
        count(supabase.from("stores").select("id", head).eq("status", "published")),
        count(supabase.from("products").select("id", head).eq("status", "active")),
        count(supabase.from("products").select("id", head).eq("status", "draft")),
        count(supabase.from("categories").select("id", head)),
        supabase.from("stores").select("owner_id"),
      ]);
    if (owners.error) throw owners.error;
    const sellers = new Set((owners.data as Pick<StoreRow, "owner_id">[]).map((s) => s.owner_id))
      .size;
    return { storesWaiting, storesPublished, productsActive, productsDraft, sellers, categories };
  },

  storeProducts: async (storeId: string) => {
    const { data, error } = await supabase
      .from("products")
      .select("id, title, status, price, stock, featured_image, created_at")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data as Pick<
      ProductRow,
      "id" | "title" | "status" | "price" | "stock" | "featured_image" | "created_at"
    >[];
  },

  /** The signed-in user's id (to hide approve buttons on their own stores). */
  myUserId: currentUserId,

  listContent: async <T extends ContentTable>(table: T): Promise<ContentRow<T>[]> => {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .order("display_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data as ContentRow<T>[];
  },

  createContent: async <T extends ContentTable>(table: T, input: unknown) => {
    const values = CONTENT_SCHEMAS[table].parse(input);
    const { error } = await supabase.from(table).insert(values as Record<string, unknown>);
    if (error) throw error;
  },

  updateContent: async <T extends ContentTable>(table: T, id: string, input: unknown) => {
    const values = CONTENT_SCHEMAS[table].parse(input);
    const { data, error } = await supabase
      .from(table)
      .update(values as Record<string, unknown>)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    expectRows(data, "item");
  },

  deleteContent: async (table: ContentTable, id: string) => {
    const { data, error } = await supabase.from(table).delete().eq("id", id).select("id");
    if (error) throw error;
    expectRows(data, "item");
  },

  /** Uploads to <bucket>/<uid>/homepage/… and returns the public https URL. */
  uploadContentImage: async (file: File): Promise<string> => {
    if (!file.type.startsWith("image/"))
      throw new Error("Choose an image file (JPG, PNG or WebP).");
    if (file.size > CONTENT_IMAGE_MAX_BYTES) throw new Error("Images can be up to 5 MB.");
    const uid = await currentUserId();
    const ext = (file.name.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
    const path = `${uid}/homepage/${crypto.randomUUID()}.${ext || "jpg"}`;
    const { error } = await supabase.storage
      .from(CONTENT_IMAGE_BUCKET)
      .upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return supabase.storage.from(CONTENT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  },

  /** The one site_settings row, content fields only (footer_settings is never read here). */
  getSiteTexts: async (): Promise<{ id: string } & SiteTexts> => {
    const { data, error } = await supabase
      .from("site_settings")
      .select(["id", ...SITE_TEXT_FIELDS].join(", "))
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("The site_settings row is missing in the database.");
    return data as unknown as { id: string } & SiteTexts;
  },

  saveSiteTexts: async (id: string, input: unknown) => {
    const values = siteTextsSchema.parse(input);
    const { data, error } = await supabase
      .from("site_settings")
      .update({ ...values, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    expectRows(data, "site texts");
  },
};
