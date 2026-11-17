/**
 * Site-wide page views from the browser (admin → Visitors).
 *
 * Privacy: the payload is the page's path (no query string or hash), whether
 * it is the first page of the visit, and only on that first page the
 * referrer's host name and the utm_* tags. No user id, no cookies, no browser
 * storage, no fingerprinting.
 */
import { isStaff } from "./staff-access";
import {
  cleanPath,
  isTrackedPath,
  PAGEVIEW_PATH,
  referrerHost,
  utmFrom,
  type PageviewBody,
} from "./pageview-core";

/** Staff (admin, content_admin, finance_admin) are never counted. */
export const isCountedSiteViewer = (roles: readonly string[]) => !isStaff(roles);

/** The body for one page view, or null when this page isn't counted. */
export function buildPageview(input: {
  pathname: string;
  /** location.search, only read for the first page. */
  search: string;
  referrer: string;
  host: string;
  rootDomain: string;
  isEntry: boolean;
  storeId: string | null;
}): PageviewBody | null {
  const path = cleanPath(input.pathname);
  if (!isTrackedPath(path)) return null;
  const body: PageviewBody = { path, is_entry: input.isEntry };
  if (input.isEntry) {
    const host = referrerHost(input.referrer, input.host, input.rootDomain);
    if (host) body.referrer_host = host;
    Object.assign(body, utmFrom(input.search));
  }
  if (input.storeId) body.store_id = input.storeId;
  return body;
}

/** Fire-and-forget: sendBeacon, else fetch with keepalive. Never throws. */
export function sendPageview(body: PageviewBody) {
  const json = JSON.stringify(body);
  try {
    if (typeof navigator !== "undefined" && navigator.sendBeacon?.(PAGEVIEW_PATH, json)) return;
  } catch {
    /* fall back to fetch */
  }
  try {
    void fetch(PAGEVIEW_PATH, {
      method: "POST",
      body: json,
      keepalive: true,
      credentials: "omit",
      headers: { "content-type": "application/json" },
    }).catch(() => {});
  } catch {
    /* tracking must never affect the page */
  }
}
