/**
 * sitemap.xml: which public URLs exist, built from the live data. Never a
 * draft or inactive product, an unpublished store, an empty category or a
 * noindex page (cart, checkout, account, search results, dashboards…).
 * Pure, so it is tested directly; the data comes from ./sitemap.server.
 */
import { canonicalFor } from "./seo";

/** Google's limit is 50,000; smaller files keep each response quick. */
export const SITEMAP_MAX_URLS = 5000;
/** The category page's default price filter (Browse): products above it aren't listed there. */
export const CATEGORY_LISTED_MAX_PRICE = 200;

export interface SitemapEntry {
  path: string;
  /** ISO date or timestamp. */
  lastmod?: string | null | undefined;
}

export interface SitemapData {
  products: {
    id: string;
    slug: string | null;
    status: string;
    created_at: string;
    price: number | string;
    category: string | null;
    store_status: string | null;
  }[];
  stores: { slug: string; status: string; updated_at: string | null }[];
  categories: { slug: string }[];
  legal: { slug: string; updated: string }[];
}

/** The main site's indexable pages (the same ones without noindex). */
const STATIC_PAGES = ["/", "/products", "/stores", "/help", "/legal"];

const newest = (dates: (string | null | undefined)[]) =>
  dates
    .filter((d): d is string => !!d)
    .sort()
    .at(-1) ?? null;

export function sitemapEntries(d: SitemapData): SitemapEntry[] {
  const live = d.products.filter((p) => p.status === "active" && p.store_status === "published");
  const stores = d.stores.filter((s) => s.status === "published");
  // A category page is indexed only when it lists at least one product.
  const listedIn = new Map<string, string[]>();
  for (const p of live)
    if (p.category && Number(p.price) <= CATEGORY_LISTED_MAX_PRICE)
      listedIn.set(p.category, [...(listedIn.get(p.category) ?? []), p.created_at]);
  const latest = newest(live.map((p) => p.created_at));

  return [
    ...STATIC_PAGES.map((path) => ({
      path,
      lastmod: path === "/" || path === "/products" ? latest : null,
    })),
    ...d.legal.map((l) => ({ path: `/legal/${l.slug}`, lastmod: l.updated })),
    ...d.categories
      .filter((c) => listedIn.has(c.slug))
      .map((c) => ({
        path: `/category/${encodeURIComponent(c.slug)}`,
        lastmod: newest(listedIn.get(c.slug) ?? []),
      })),
    ...stores.map((s) => ({ path: `/store/${encodeURIComponent(s.slug)}`, lastmod: s.updated_at })),
    ...live.map((p) => ({
      path: `/product/${encodeURIComponent(p.slug || p.id)}`,
      lastmod: p.created_at,
    })),
  ];
}

export const escapeXml = (s: string) =>
  s.replace(/[<>&'"]/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === "'" ? "&apos;" : "&quot;",
  );

/** "2026-11-18" from any ISO date/timestamp; null when it isn't one. */
export function w3cDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

export function urlsetXml(entries: SitemapEntry[], origin: string): string {
  const urls = entries.map((e) => {
    const loc = canonicalFor(e.path, origin)!;
    const lastmod = w3cDate(e.lastmod);
    return `  <url><loc>${escapeXml(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

export function sitemapIndexXml(parts: number, origin: string): string {
  const items = Array.from(
    { length: parts },
    (_, i) => `  <sitemap><loc>${escapeXml(`${origin}/sitemap.xml?part=${i + 1}`)}</loc></sitemap>`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items.join("\n")}\n</sitemapindex>\n`;
}

/**
 * The XML for /sitemap.xml (`part` = null) or /sitemap.xml?part=N. Up to
 * 5,000 URLs: one urlset. More: an index of parts of 5,000 each.
 * Null for a part that doesn't exist.
 */
export function sitemapXml(entries: SitemapEntry[], origin: string, part: number | null) {
  const parts = Math.ceil(entries.length / SITEMAP_MAX_URLS);
  if (part === null)
    return parts <= 1 ? urlsetXml(entries, origin) : sitemapIndexXml(parts, origin);
  if (!Number.isInteger(part) || part < 1 || part > Math.max(1, parts)) return null;
  return urlsetXml(entries.slice((part - 1) * SITEMAP_MAX_URLS, part * SITEMAP_MAX_URLS), origin);
}
