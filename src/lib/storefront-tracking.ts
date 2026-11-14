/**
 * Which page views count as a storefront view, and sending them.
 *
 * Privacy: the payload is `{ store_id }` only (no path, referrer or user id).
 * Nothing is read from or written to cookies or browser storage.
 */
import { isStaff } from "./staff-access";
import { TRACK_PATH } from "./track-core";

/**
 * The slug of the store this page belongs to, or null when it isn't a storefront view.
 *  - A store's own site (<slug>.saloree.com, `siteStoreSlug`): its home, all
 *    products, a category and a product page.
 *  - The main site: /store/<slug>, and a product page (it belongs to its store).
 * Never the marketplace home, checkout, cart, account, seller, admin or preview pages.
 */
export function trackedStoreSlug(
  pathname: string,
  ctx: { siteStoreSlug: string | null; productStoreSlug: string | null },
): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (/^\/product\/[^/]+$/.test(path)) return ctx.productStoreSlug;
  if (ctx.siteStoreSlug)
    return path === "/" || path === "/products" || /^\/category\/[^/]+$/.test(path)
      ? ctx.siteStoreSlug
      : null;
  const m = /^\/store\/([^/]+)$/.exec(path);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return null;
  }
}

/** The store's owner and staff (admin roles) are never counted. */
export function isCountedViewer(
  viewer: { userId: string | null; roles: readonly string[] },
  store: { ownerId?: string | null },
): boolean {
  if (isStaff(viewer.roles)) return false;
  return !(viewer.userId && store.ownerId && viewer.userId === store.ownerId);
}

/** Fire-and-forget: sendBeacon, else fetch with keepalive. Never throws. */
export function sendTrack(storeId: string) {
  const body = JSON.stringify({ store_id: storeId });
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon?.(TRACK_PATH, body)) return;
  } catch {
    /* fall back to fetch */
  }
  try {
    void fetch(TRACK_PATH, {
      method: "POST",
      body,
      keepalive: true,
      credentials: "omit",
      headers: { "content-type": "application/json" },
    }).catch(() => {});
  } catch {
    /* tracking must never affect the page */
  }
}
