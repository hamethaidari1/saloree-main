import { queryOptions } from "@tanstack/react-query";
import type { Catalog, Category, Product, Store } from "@/data/catalog";
import type { CategoryRow, ProductRow, StoreRow } from "@/data/db";
import { supabase } from "@/lib/supabase";
import { categoryImage } from "@/data/category-images";

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><rect width="384" height="512" fill="#f1ede6"/></svg>',
  );
const TONES = ["sage", "rose", "blue", "peach"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The seller form's slug rule (lowercase letters, numbers, single hyphens). */
const PRODUCT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

/** The product's URL part: its slug, else (older data, fixtures) its id. */
export const productParam = (p: { id: string; slug?: string | undefined }) => p.slug || p.id;
/** "/product/<slug>" — the one address of a product page. */
export const productPath = (p: { id: string; slug?: string | undefined }) =>
  `/product/${encodeURIComponent(productParam(p))}`;

const PRODUCT_SELECT =
  "id, store_id, category_id, title, slug, description, price, compare_price, stock, featured_image, status, created_at, brand, colors, sizes," +
  " stores!inner(slug, status), categories(slug), product_images(image_url, sort_order)";
const STORE_SELECT =
  "id, owner_id, name, slug, description, logo_url, banner_url, category, location, status, created_at, updated_at";

type ProductQueryRow = ProductRow & {
  stores: { slug: string; status: string } | null;
  categories: { slug: string } | null;
  product_images: { image_url: string; sort_order: number | null }[] | null;
};

function hash(text: string) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function initialsFor(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = (words.length > 1 ? words.slice(0, 2).map((w) => w[0]) : [name.slice(0, 2)]).join(
    "",
  );
  return letters.toLowerCase();
}

/**
 * All of a product's photos: `featured_image` first, then `product_images` in
 * sort_order, each URL once (the first gallery row is usually the featured
 * file itself), blanks dropped.
 */
export function productImageList(
  featured: string | null | undefined,
  rows: { image_url: string; sort_order: number | null }[] | null | undefined,
): string[] {
  const ordered = [...(rows ?? [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((r) => r.image_url);
  const out: string[] = [];
  for (const url of [featured, ...ordered]) {
    const u = url?.trim();
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

/** The photos to show for a product (falls back to the single main image). */
export const imagesOf = (p: Pick<Product, "image" | "images">) =>
  p.images?.length ? p.images : [p.image];

export function toProduct(row: ProductQueryRow): Product {
  const price = Number(row.price);
  const compare = row.compare_price == null ? undefined : Number(row.compare_price);
  const images = productImageList(row.featured_image, row.product_images);
  const onSale = compare !== undefined && compare > price;
  return {
    id: row.id,
    ...(row.slug ? { slug: row.slug } : {}),
    title: row.title,
    price,
    ...(onSale ? { originalPrice: compare, badge: "Sale" } : {}),
    rating: 0,
    reviews: 0,
    storeSlug: row.stores?.slug ?? "",
    category: row.categories?.slug ?? "",
    image: images[0] ?? PLACEHOLDER_IMAGE,
    images: images.length ? images : [PLACEHOLDER_IMAGE],
    stock: Math.max(0, row.stock ?? 0),
    description: row.description ?? "",
    createdAt: Date.parse(row.created_at),
    brand: row.brand?.trim() || null,
    colors: row.colors ?? [],
    sizes: row.sizes ?? [],
  };
}

export function toStore(row: StoreRow): Store {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    initials: initialsFor(row.name),
    description: row.description ?? "",
    rating: 0,
    specialty: row.category ?? row.location ?? "",
    image: row.banner_url || row.logo_url || PLACEHOLDER_IMAGE,
    logo: row.logo_url || null,
    banner: row.banner_url || null,
    ownerId: row.owner_id ?? null,
    tone: TONES[hash(row.slug) % TONES.length] ?? "sage",
  };
}

/** Category images are bundled per slug; never borrowed from a product. "" = none. */
export function toCategories(rows: Pick<CategoryRow, "slug" | "name">[]): Category[] {
  return rows.map((c) => ({
    slug: c.slug,
    name: c.name,
    image: categoryImage(c.slug)?.large ?? "",
  }));
}

function productsQuery() {
  return supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .eq("status", "active")
    .eq("stores.status", "published");
}

export const catalogService = {
  getCatalog: async (): Promise<Catalog> => {
    const [productsRes, storesRes, categoriesRes] = await Promise.all([
      productsQuery().order("created_at", { ascending: false }),
      supabase.from("stores").select(STORE_SELECT).eq("status", "published").order("created_at"),
      supabase.from("categories").select("id, name, slug, created_at").order("name"),
    ]);
    if (productsRes.error) throw productsRes.error;
    if (storesRes.error) throw storesRes.error;
    if (categoriesRes.error) throw categoriesRes.error;
    const products = (productsRes.data as unknown as ProductQueryRow[]).map(toProduct);
    return {
      products,
      stores: (storesRes.data as StoreRow[]).map(toStore),
      categories: toCategories(categoriesRes.data as CategoryRow[]),
    };
  },
  /** By its slug (the URL) or, for old links, its id. */
  getProduct: async (idOrSlug: string): Promise<Product | undefined> => {
    const byId = UUID.test(idOrSlug);
    if (!byId && !PRODUCT_SLUG.test(idOrSlug)) return undefined;
    const { data, error } = await productsQuery()
      .eq(byId ? "id" : "slug", byId ? idOrSlug : idOrSlug.toLowerCase())
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? toProduct(data as unknown as ProductQueryRow) : undefined;
  },
  getStore: async (slug: string): Promise<Store | undefined> => {
    const { data, error } = await supabase
      .from("stores")
      .select(STORE_SELECT)
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle();
    if (error) throw error;
    return data ? toStore(data as StoreRow) : undefined;
  },
};

export const catalogQuery = queryOptions({
  queryKey: ["catalog"],
  queryFn: catalogService.getCatalog,
  staleTime: 60_000,
});

export const money = (amount: number, currency: string | null = "USD") => {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "USD").toUpperCase(),
    }).format(amount);
  } catch {
    // Unknown currency code from the server: still show the amount.
    return `${amount.toFixed(2)} ${currency}`;
  }
};

const fold = (v: string) => v.trim().toLocaleLowerCase();

/**
 * Brand / color / size filters (case-insensitive): a product matches a color
 * or size when it is one of the product's own; "" = any.
 */
export function matchOptions<T extends Pick<Product, "brand" | "colors" | "sizes">>(
  products: T[],
  f: { brand?: string; color?: string; size?: string },
): T[] {
  const brand = f.brand ? fold(f.brand) : "";
  const color = f.color ? fold(f.color) : "";
  const size = f.size ? fold(f.size) : "";
  return products.filter(
    (p) =>
      (!brand || fold(p.brand ?? "") === brand) &&
      (!color || (p.colors ?? []).some((c) => fold(c) === color)) &&
      (!size || (p.sizes ?? []).some((s) => fold(s) === size)),
  );
}

/** The brands, colors and sizes that occur, each once (case-insensitive), sorted. */
export function optionFacets(products: Pick<Product, "brand" | "colors" | "sizes">[]) {
  const unique = (values: (string | null | undefined)[]) => {
    const seen = new Map<string, string>();
    for (const v of values) {
      const t = v?.trim();
      if (t && !seen.has(fold(t))) seen.set(fold(t), t);
    }
    return [...seen.values()];
  };
  const alpha = (a: string, b: string) => a.localeCompare(b);
  return {
    brands: unique(products.map((p) => p.brand)).sort(alpha),
    colors: unique(products.flatMap((p) => p.colors ?? [])).sort(alpha),
    // Sizes keep their first-seen order (S, M, L… rather than L, M, S).
    sizes: unique(products.flatMap((p) => p.sizes ?? [])),
  };
}

/**
 * The price slider's range: whole units from the cheapest to the dearest of
 * the products in view (equal when there is one price; 0–0 when none).
 */
export function priceBounds(products: Pick<Product, "price">[]) {
  if (!products.length) return { min: 0, max: 0 };
  const prices = products.map((p) => p.price);
  return { min: Math.floor(Math.min(...prices)), max: Math.ceil(Math.max(...prices)) };
}

/** A step that gives the slider about 100 positions (1 for small ranges). */
export const priceStep = (b: { min: number; max: number }) =>
  Math.max(1, Math.round((b.max - b.min) / 100));

export function filterProducts(
  options: {
    query?: string;
    category?: string;
    store?: string;
    maxPrice?: number;
    rating?: number;
    sort?: string;
  },
  catalog: Pick<Catalog, "products" | "stores">,
) {
  const { products, stores } = catalog;
  const q = options.query?.toLowerCase().trim();
  const result = products.filter(
    (p) =>
      (!q ||
        `${p.title} ${stores.find((s) => s.slug === p.storeSlug)?.name}`
          .toLowerCase()
          .includes(q)) &&
      (!options.category || p.category === options.category) &&
      (!options.store || p.storeSlug === options.store) &&
      p.price <= (options.maxPrice ?? Infinity) &&
      p.rating >= (options.rating ?? 0),
  );
  return result.sort((a, b) =>
    options.sort === "price-low"
      ? a.price - b.price
      : options.sort === "price-high"
        ? b.price - a.price
        : options.sort === "popular"
          ? b.reviews - a.reviews
          : (b.createdAt ?? 0) - (a.createdAt ?? 0),
  );
}
