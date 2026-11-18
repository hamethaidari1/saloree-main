import type { Product } from "@/data/catalog";
import { lineKey, validSelection } from "@/lib/product-options";

/**
 * One cart line: a product in one color and size. The same product with
 * another color or size is a separate line; the same choice adds up.
 */
export interface CartItem {
  productId: string;
  quantity: number;
  color?: string | null;
  size?: string | null;
}
/** Which line (product + color + size). */
export type CartLine = Pick<CartItem, "productId" | "color" | "size">;
type CartProduct = Pick<Product, "id" | "stock" | "price"> &
  Partial<Pick<Product, "colors" | "sizes">>;

export { lineKey };

/** The color/size keys only when chosen: a plain product's line stays `{ productId, quantity }`. */
const chosen = (sel: { color: string | null; size: string | null }) => ({
  ...(sel.color ? { color: sel.color } : {}),
  ...(sel.size ? { size: sel.size } : {}),
});

/** How many of this product the other lines already hold (stock is shared by all options). */
export const otherLinesQuantity = (items: readonly CartItem[], line: CartLine) =>
  items
    .filter((i) => i.productId === line.productId && lineKey(i) !== lineKey(line))
    .reduce((s, i) => s + i.quantity, 0);

/** The most this line can hold: the stock minus what the product's other lines hold. */
export const lineMax = (items: readonly CartItem[], line: CartLine, stock: number) =>
  Math.max(0, Math.floor(stock) - otherLinesQuantity(items, line));

// Persistence lives in src/lib/cartStorage.ts (cookie across subdomains in production).
/**
 * Saved lines checked against the live catalog: unknown or sold-out products
 * dropped, a color/size that is no longer the product's own dropped (the
 * buyer chooses again), equal lines merged, and each product's lines together
 * capped to its stock.
 */
export function normalizeCart(value: unknown, products: CartProduct[]): CartItem[] {
  if (!Array.isArray(value)) return [];
  const result: CartItem[] = [];
  for (const item of value as Partial<CartItem>[]) {
    if (typeof item !== "object" || item === null) continue;
    const product = products.find((p) => p.id === item.productId);
    if (!product || product.stock < 1 || !Number.isInteger(item.quantity) || item.quantity! < 1)
      continue;
    const sel = validSelection(product, { color: item.color, size: item.size });
    if (!sel) continue;
    const line: CartItem = { productId: product.id, quantity: 0, ...chosen(sel) };
    const prior = result.find((i) => lineKey(i) === lineKey(line));
    const room = lineMax(result, line, product.stock) - (prior?.quantity ?? 0);
    const add = Math.min(room, item.quantity!);
    if (add < 1) continue;
    if (prior) prior.quantity += add;
    else result.push({ ...line, quantity: add });
  }
  return result;
}

/** Sets one line's quantity (0 removes it), within the product's shared stock. */
export function updateCart(
  items: CartItem[],
  line: CartLine | string,
  quantity: number,
  products: CartProduct[],
): CartItem[] {
  const target: CartLine = typeof line === "string" ? { productId: line } : line;
  const p = products.find((p) => p.id === target.productId);
  if (!p) return items;
  const sel = validSelection(p, target);
  const key = lineKey(target);
  const index = items.findIndex((i) => lineKey(i) === key);
  const rest = items.filter((i) => lineKey(i) !== key);
  const max = lineMax(items, target, p.stock);
  if (quantity <= 0 || p.stock < 1 || !sel || max < 1) return rest;
  const next: CartItem = {
    productId: p.id,
    quantity: Math.min(max, Math.max(1, Math.floor(quantity))),
    ...chosen(sel),
  };
  // Keep the line where it was.
  if (index < 0) return [...rest, next];
  return [...rest.slice(0, index), next, ...rest.slice(index)];
}

export const cartTotal = (items: CartItem[], products: CartProduct[]) =>
  items.reduce(
    (sum, i) => sum + (products.find((p) => p.id === i.productId)?.price ?? 0) * i.quantity,
    0,
  );
