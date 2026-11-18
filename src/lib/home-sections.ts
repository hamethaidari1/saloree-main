/**
 * The marketplace home page's product shelves, built from the catalog the
 * page already has (the same cached query as every product card), so the
 * shelves cost no extra requests. Pure, so they're tested directly.
 *
 * The catalog only holds active products of published stores. Products in
 * stock come first everywhere; nothing is ever invented to fill a shelf.
 */
import type { Category, Product } from "@/data/catalog";

/** Products per shelf (12 = full rows at 2, 3 and 4 columns; 5 columns shows 10). */
export const SHELF_SIZE = 12;
/** "More products for you": first page and each "Load more". */
export const MORE_PAGE = 24;
/** Category shelves: the categories with the most products. */
export const MAX_CATEGORY_SHELVES = 6;
/** A later shelf is shown only when it adds at least this many products not shown above. */
export const MIN_NEW_IN_SHELF = 4;

const newest = (a: Product, b: Product) => (b.createdAt ?? 0) - (a.createdAt ?? 0);
const inStock = (p: Product) => (p.stock ?? 0) > 0;

/** In stock first, otherwise in the given order (stable). */
export function inStockFirst(products: readonly Product[]): Product[] {
  return [...products.filter(inStock), ...products.filter((p) => !inStock(p))];
}

/** Newest first, in stock first. */
export const byNewest = (products: readonly Product[]) => inStockFirst([...products].sort(newest));

export function newArrivals(products: readonly Product[], size = SHELF_SIZE): Product[] {
  return byNewest(products).slice(0, size);
}

/**
 * "Popular": only when there is real popularity data (reviews). Without it the
 * shelf is empty, and therefore hidden, rather than relabelling the newest.
 */
export function popular(products: readonly Product[], size = SHELF_SIZE): Product[] {
  const rated = products.filter((p) => (p.reviews ?? 0) > 0);
  return inStockFirst(
    [...rated].sort((a, b) => (b.reviews ?? 0) - (a.reviews ?? 0) || newest(a, b)),
  ).slice(0, size);
}

export interface CategoryShelf {
  category: Category;
  products: Product[];
  /** All products in the category (for "View all"). */
  total: number;
  /** How many of its products were not already shown above (`seen`). */
  unseen: number;
}

/**
 * The categories with the most products, each with its newest products.
 * Products already shown higher up (`seen`, e.g. New arrivals) come last, so a
 * category shelf doesn't repeat the row above it but is still full.
 */
export function categoryShelves(
  products: readonly Product[],
  categories: readonly Category[],
  max = MAX_CATEGORY_SHELVES,
  size = SHELF_SIZE,
  seen: ReadonlySet<string> = new Set(),
): CategoryShelf[] {
  const order = new Map(categories.map((c, i) => [c.slug, i]));
  const bySlug = new Map<string, Product[]>();
  for (const p of products) {
    if (!p.category || !order.has(p.category)) continue;
    const list = bySlug.get(p.category) ?? [];
    list.push(p);
    bySlug.set(p.category, list);
  }
  return [...bySlug.entries()]
    .sort(([a, la], [b, lb]) => lb.length - la.length || (order.get(a) ?? 0) - (order.get(b) ?? 0))
    .slice(0, max)
    .flatMap(([slug, list]) => {
      const category = categories.find((c) => c.slug === slug);
      return category
        ? [
            {
              category,
              products: [
                ...byNewest(list.filter((p) => !seen.has(p.id))),
                ...byNewest(list.filter((p) => seen.has(p.id))),
              ].slice(0, size),
              total: list.length,
              unseen: list.filter((p) => !seen.has(p.id)).length,
            },
          ]
        : [];
    });
}

/**
 * Every product, for "More products for you": the ones not shown above first,
 * then the rest; each part in stock first, newest first.
 */
export const allForYou = (products: readonly Product[], seen: ReadonlySet<string> = new Set()) => [
  ...byNewest(products.filter((p) => !seen.has(p.id))),
  ...byNewest(products.filter((p) => seen.has(p.id))),
];

/** How many to show after `clicks` presses of "Load more". */
export const moreShown = (clicks: number, total: number) =>
  Math.min(total, MORE_PAGE * (clicks + 1));
