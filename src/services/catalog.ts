import { queryOptions } from "@tanstack/react-query";
import type { Catalog, Category, Product, Store } from "@/data/catalog";
import type { CategoryRow, ProductRow, StoreRow } from "@/data/db";
import { supabase } from "@/lib/supabase";

const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 512"><rect width="384" height="512" fill="#f1ede6"/></svg>',
  );
const TONES = ["sage", "rose", "blue", "peach"] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PRODUCT_SELECT =
  "id, store_id, category_id, title, slug, description, price, compare_price, stock, featured_image, status, created_at," +
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

export function toProduct(row: ProductQueryRow): Product {
  const price = Number(row.price);
  const compare = row.compare_price == null ? undefined : Number(row.compare_price);
  const firstImage = [...(row.product_images ?? [])].sort(
    (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
  )[0]?.image_url;
  const onSale = compare !== undefined && compare > price;
  return {
    id: row.id,
    title: row.title,
    price,
    ...(onSale ? { originalPrice: compare, badge: "Sale" } : {}),
    rating: 0,
    reviews: 0,
    storeSlug: row.stores?.slug ?? "",
    category: row.categories?.slug ?? "",
    image: row.featured_image || firstImage || PLACEHOLDER_IMAGE,
    stock: Math.max(0, row.stock ?? 0),
    description: row.description ?? "",
    createdAt: Date.parse(row.created_at),
  };
}

export function toStore(row: StoreRow): Store {
  return {
    slug: row.slug,
    name: row.name,
    initials: initialsFor(row.name),
    description: row.description ?? "",
    rating: 0,
    specialty: row.category ?? row.location ?? "",
    image: row.banner_url || row.logo_url || PLACEHOLDER_IMAGE,
    tone: TONES[hash(row.slug) % TONES.length] ?? "sage",
  };
}

function toCategories(rows: CategoryRow[], products: Product[]): Category[] {
  return rows.map((c) => ({
    slug: c.slug,
    name: c.name,
    image: products.find((p) => p.category === c.slug)?.image ?? PLACEHOLDER_IMAGE,
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
      categories: toCategories(categoriesRes.data as CategoryRow[], products),
    };
  },
  getProduct: async (id: string): Promise<Product | undefined> => {
    if (!UUID.test(id)) return undefined;
    const { data, error } = await productsQuery().eq("id", id).maybeSingle();
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

export const money = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);

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
