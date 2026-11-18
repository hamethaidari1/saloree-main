/**
 * "Buy now": a checkout of one product only, described by the address
 * (/checkout?buy=<productId>&qty=<n>&color=<c>&size=<s>) and never written
 * into the bag. An id, a number and the chosen color/size only: nothing
 * personal in the URL. place_order checks the color and size on the server.
 */

export interface BuyNowSearch {
  buy?: string;
  qty?: number;
  color?: string;
  size?: string;
}

/** A color (30) or size (20) as the database allows; anything longer is ignored. */
const optionParam = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() && v.length <= max ? v : undefined;

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Only a plausible product id and a whole quantity are read from the address. */
export function parseBuyNowSearch(s: Record<string, unknown>): BuyNowSearch {
  const out: BuyNowSearch = {};
  if (typeof s["buy"] === "string" && ID.test(s["buy"])) out.buy = s["buy"];
  const q = typeof s["qty"] === "string" ? Number(s["qty"]) : s["qty"];
  if (typeof q === "number" && Number.isFinite(q)) out.qty = Math.trunc(q);
  const color = optionParam(s["color"], 30);
  const size = optionParam(s["size"], 20);
  if (color) out.color = color;
  if (size) out.size = size;
  return out;
}

/** The quantity to order: a whole number from 1 to what is in stock (0 if none). */
export function buyNowQuantity(requested: number | undefined, stock: number): number {
  if (stock < 1) return 0;
  const q = Math.trunc(requested ?? 1);
  if (!Number.isFinite(q) || q < 1) return 1;
  return Math.min(q, Math.floor(stock));
}
