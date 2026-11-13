/**
 * Store subdomains: `<slug>.<VITE_ROOT_DOMAIN>` renders that store's own
 * storefront. Everything here is pure (no window access) so it runs the same
 * on the server and in the browser, and is unit-tested.
 */

/**
 * Addresses no store may use. Used by the store form (instant feedback; the
 * database remains the authority) and by the host check, which treats these
 * subdomains (www, app, help, api, …) as the main site, never as a store.
 */
export const RESERVED_STORE_SLUGS = [
  "www",
  "app",
  "admin",
  "api",
  "seller",
  "sellers",
  "store",
  "stores",
  "shop",
  "shops",
  "mail",
  "email",
  "smtp",
  "imap",
  "ftp",
  "cdn",
  "static",
  "assets",
  "img",
  "images",
  "help",
  "support",
  "blog",
  "status",
  "dev",
  "test",
  "staging",
  "checkout",
  "cart",
  "account",
  "login",
  "signup",
  "auth",
  "billing",
  "pay",
  "payments",
  "docs",
  "saloree",
  "ns1",
  "ns2",
  "dashboard",
  "root",
  "secure",
] as const;

/** DNS-safe label: a-z 0-9 and "-", 3–63 chars, no leading/trailing dash. */
export const STORE_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;

/** Dev-only override so store mode can be tested on localhost without DNS. */
export const DEV_STORE_PARAM = "store";
export const DEV_STORE_SESSION_KEY = "saloree-dev-store";
export const DEV_STORE_COOKIE = "saloree_dev_store";

/** "Shop.Example.com:8080." → "shop.example.com" (also handles "[::1]:8080"). */
export function normalizeHost(host: string) {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[")) h = h.slice(0, h.indexOf("]") + 1);
  else h = h.replace(/:\d+$/, "");
  return h.replace(/\.+$/, "");
}

export const normalizeDomain = (domain: string | undefined | null) =>
  normalizeHost(domain ?? "").replace(/^\.+/, "");

/**
 * The store slug encoded in the host, or null for the main marketplace
 * (root domain, reserved names like www/app/help/api, localhost, preview
 * URLs, nested subdomains…).
 */
export function getStoreSlugFromHost(hostname: string, rootDomain: string): string | null {
  const root = normalizeDomain(rootDomain);
  const host = normalizeHost(hostname);
  if (!root || !host || host === root || !host.endsWith(`.${root}`)) return null;
  const label = host.slice(0, -(root.length + 1));
  if (label.includes(".")) return null;
  // Reserved names (www, app, help, api, admin, …) are never stores: main site.
  if ((RESERVED_STORE_SLUGS as readonly string[]).includes(label)) return null;
  return STORE_SLUG_RE.test(label) ? label : null;
}

/** Same shape rules a store slug must follow (see the database's check). */
export const isValidStoreSlug = (slug: string) =>
  STORE_SLUG_RE.test(slug) && !(RESERVED_STORE_SLUGS as readonly string[]).includes(slug);

/**
 * Dev override from `?store=`: a slug sets it, an empty value (or "off")
 * clears it, absent leaves the saved choice (session, then cookie) in place.
 */
export function resolveDevStore(input: {
  param: unknown;
  session: string | null;
  cookie: string | null;
}): { slug: string | null; persist: "set" | "clear" | null } {
  if (typeof input.param === "string") {
    const value = input.param.trim().toLowerCase();
    if (!value || value === "off") return { slug: null, persist: "clear" };
    return STORE_SLUG_RE.test(value)
      ? { slug: value, persist: "set" }
      : { slug: null, persist: "clear" };
  }
  const saved = input.session ?? input.cookie;
  return { slug: saved && STORE_SLUG_RE.test(saved) ? saved : null, persist: null };
}

/** Paths that only exist on the main site (account, checkout, dashboards). */
const MAIN_ONLY_PREFIXES = [
  "/seller",
  "/admin",
  "/checkout",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/auth",
  "/account",
  "/order-confirmation",
  "/stores",
  "/store",
];
export function isMainOnlyPath(pathname: string) {
  return MAIN_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

// ---------------------------------------------------------------------------
// URL builders (read the configured domain; never hard-coded)
// ---------------------------------------------------------------------------
export interface HostConfig {
  rootDomain: string;
  dev: boolean;
  /** Current origin in the browser (dev links); undefined on the server. */
  origin?: string | undefined;
}

export const hostConfig = (): HostConfig => ({
  rootDomain: normalizeDomain(import.meta.env.VITE_ROOT_DOMAIN),
  dev: import.meta.env.DEV,
  origin: typeof window === "undefined" ? undefined : window.location.origin,
});

/** The public address shown to people: https://<slug>.<root>. */
export function storePublicAddress(slug: string, cfg: HostConfig = hostConfig()) {
  return cfg.rootDomain ? `https://${slug}.${cfg.rootDomain}` : null;
}

/** The store's address as people type it: "slug.saloree.com" (no https://). */
export function storeAddressLabel(slug: string, cfg: HostConfig = hostConfig()) {
  const address = storePublicAddress(slug, cfg);
  return address ? address.replace(/^https?:\/\//, "") : `/store/${slug}`;
}

/**
 * A working link to the store's own storefront. Dev: same origin with
 * `?store=` (no DNS needed). No domain configured: the marketplace store page.
 */
export function storeUrl(slug: string, cfg: HostConfig = hostConfig()) {
  if (cfg.dev) return `${cfg.origin ?? ""}/?${DEV_STORE_PARAM}=${encodeURIComponent(slug)}`;
  return storePublicAddress(slug, cfg) ?? `/store/${encodeURIComponent(slug)}`;
}

/**
 * A link to `path` on the main marketplace. Dev: same origin, clearing the
 * store override. No domain configured: a relative path.
 */
export function mainSiteUrl(path = "/", cfg: HostConfig = hostConfig()) {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (cfg.dev) return `${p}${p.includes("?") ? "&" : "?"}${DEV_STORE_PARAM}=`;
  return cfg.rootDomain ? `https://${cfg.rootDomain}${p}` : p;
}
