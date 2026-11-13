/**
 * Builds the one input every template renders from — from real data only.
 * The live storefront uses the public catalog; the seller's preview uses the
 * seller's own rows (so a draft store can be previewed by its owner). Both
 * end in the same `TemplateData` and are rendered by the same component.
 */
import type { Category, Product, Store } from "@/data/catalog";
import type { CategoryRow, StoreRow } from "@/data/db";
import { toCategories, toProduct, toStore } from "@/services/catalog";
import type { SellerProduct } from "@/services/seller";

export interface TemplateData {
  store: Store;
  /** This store's active products, newest first. */
  products: Product[];
  /** Only categories that this store actually has products in. */
  categories: Category[];
}

const usedCategories = (categories: Category[], products: Product[]) =>
  categories.filter((c) => products.some((p) => p.category === c.slug));

/** Live storefront: from the public catalog (published stores, active products). */
export function templateDataFromCatalog(
  store: Store,
  catalog: { products: Product[]; categories: Category[] },
): TemplateData {
  const products = catalog.products.filter((p) => p.storeSlug === store.slug);
  return { store, products, categories: usedCategories(catalog.categories, products) };
}

/** Seller preview: from the seller's own rows; only active products, like the live store. */
export function templateDataFromSeller(
  storeRow: StoreRow,
  sellerProducts: SellerProduct[],
  categoryRows: CategoryRow[],
): TemplateData {
  const store = toStore(storeRow);
  const slugById = new Map(categoryRows.map((c) => [c.id, c.slug]));
  const products = sellerProducts
    .filter((p) => p.status === "active")
    .map((p) =>
      toProduct({
        ...p,
        stores: { slug: storeRow.slug, status: storeRow.status },
        categories: p.category_id ? { slug: slugById.get(p.category_id) ?? "" } : null,
        product_images: p.product_images,
      }),
    )
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  // Same mapping as the public catalog, so the preview matches the live store.
  return { store, products, categories: usedCategories(toCategories(categoryRows), products) };
}
