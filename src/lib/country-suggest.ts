/**
 * When to offer "Deliver to <detected country>?" — pure rules, plus the
 * "not now" memory (localStorage, 30 days). Never overrides a saved choice.
 */
import { deliveryCountryForIso, type CountryCode, type DeliveryCountryCode } from "./countries";

export const SUGGEST_DISMISS_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
export const SUGGEST_DISMISS_KEY = "saloree.country-suggest-dismissed";

/** Pages where the offer would get in the way (buying, signing in, account). */
const QUIET_PREFIXES = [
  "/cart",
  "/checkout",
  "/order-confirmation",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/auth",
  "/account",
  "/wishlist",
  "/seller",
  "/admin",
  "/preview",
];
export const isQuietPath = (pathname: string) =>
  QUIET_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/** The country to offer, or null (saved choice, unknown country, dismissed, quiet page). */
export function shouldSuggestCountry(input: {
  saved: CountryCode | null;
  detected: string | null;
  dismissedAt: number | null;
  now: number;
  pathname: string;
}): DeliveryCountryCode | null {
  if (input.saved) return null; // the visitor's own choice always wins
  const code = deliveryCountryForIso(input.detected);
  if (!code) return null;
  if (isQuietPath(input.pathname)) return null;
  if (
    input.dismissedAt !== null &&
    input.now >= input.dismissedAt &&
    input.now - input.dismissedAt < SUGGEST_DISMISS_DAYS * DAY_MS
  )
    return null;
  return code;
}

type KeyValue = Pick<Storage, "getItem" | "setItem">;
function localStore(): KeyValue | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readDismissedAt(storage: KeyValue | null = localStore()): number | null {
  try {
    const v = Number(storage?.getItem(SUGGEST_DISMISS_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function saveDismissedAt(at = Date.now(), storage: KeyValue | null = localStore()) {
  try {
    storage?.setItem(SUGGEST_DISMISS_KEY, String(at));
  } catch {
    // Storage blocked: the offer may show again on the next visit.
  }
}
