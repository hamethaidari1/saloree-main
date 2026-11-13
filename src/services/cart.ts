import type { Product } from "@/data/catalog";
export interface CartItem {
  productId: string;
  quantity: number;
}
type CartProduct = Pick<Product, "id" | "stock" | "price">;
// Persistence lives in src/lib/cartStorage.ts (cookie across subdomains in production).
export function normalizeCart(value: unknown, products: CartProduct[]): CartItem[] {
  if (!Array.isArray(value)) return [];
  const result: CartItem[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const product = products.find((p) => p.id === item.productId);
    if (!product || product.stock < 1 || !Number.isInteger(item.quantity) || item.quantity < 1)
      continue;
    const prior = result.find((i) => i.productId === product.id);
    if (prior) prior.quantity = Math.min(product.stock, prior.quantity + item.quantity);
    else result.push({ productId: product.id, quantity: Math.min(product.stock, item.quantity) });
  }
  return result;
}
export function updateCart(
  items: CartItem[],
  productId: string,
  quantity: number,
  products: CartProduct[],
): CartItem[] {
  const p = products.find((p) => p.id === productId);
  if (!p) return items;
  const rest = items.filter((i) => i.productId !== productId);
  return quantity <= 0 || p.stock < 1
    ? rest
    : [...rest, { productId, quantity: Math.min(p.stock, Math.max(1, Math.floor(quantity))) }];
}
export const cartTotal = (items: CartItem[], products: CartProduct[]) =>
  items.reduce(
    (sum, i) => sum + (products.find((p) => p.id === i.productId)?.price ?? 0) * i.quantity,
    0,
  );
