/**
 * Search-engine metadata: canonical URLs, titles and descriptions within
 * Google's display limits, Open Graph / Twitter tags, and JSON-LD built only
 * from data the page really shows (no ratings without real reviews).
 *
 * Audit (before this change):
 *  - Product, store, category and home pages are server-rendered with their
 *    real data (title, description, price in the HTML); 404s return 404.
 *  - Missing: canonical links (except legal pages), og:url / og:image /
 *    og:site_name / og:locale, JSON-LD, a sitemap, Disallow rules in robots.txt,
 *    noindex on the cart; titles of long product names ran far past 60 chars.
 *  - Language is a cookie / Accept-Language choice on the SAME URL (no /fi/…
 *    paths), so there are no per-language URLs to list with hreflang: the
 *    default-language page is the one search engines index.
 *  - http and the bare domain already redirect (308) to https://www.saloree.com.
 */
import type { JSX } from "react";
import type { Locale } from "@/i18n/locales";

/** A head() meta entry. */
export type MetaTag = JSX.IntrinsicElements["meta"];

/**
 * JSON-LD as a head() meta entry: TanStack renders `script:ld+json` as
 * <script type="application/ld+json"> with the JSON HTML-escaped (so a "<"
 * in a product text can never close the script). Its types only know plain
 * meta attributes, hence the cast.
 */
export const jsonLdMeta = (data: object) => ({ "script:ld+json": data }) as unknown as MetaTag;

/** Tracking and page-state parameters never belong in a canonical URL. */
const NON_CANONICAL_PARAMS =
  /^(utm_[a-z]+|gclid|fbclid|msclkid|ref|sort|page|q|brand|color|size|sale|category|save|country|store)$/i;

export const SITE_NAME = "Saloree";
export const LEGAL_NAME = "Siirtamo Oy";
export const TITLE_MAX = 60;
export const DESCRIPTION_MIN = 120;
export const DESCRIPTION_MAX = 160;
/** Shared preview image (1200×630) for pages without their own. */
export const OG_DEFAULT_IMAGE = "/og-default.png";

/** https://www.<root domain> — the one host search engines should index. */
export function siteOrigin(rootDomain: string | null | undefined): string | null {
  const d = rootDomain
    ?.trim()
    .toLowerCase()
    .replace(/^www\./, "");
  return d ? `https://www.${d}` : null;
}

/**
 * The canonical URL of a path: absolute, on the www host, without a trailing
 * slash (except the home page), a #hash or tracking / page-state parameters.
 */
export function canonicalFor(path: string, origin: string | null): string | null {
  if (!origin) return null;
  const url = new URL(path.startsWith("/") ? path : `/${path}`, origin);
  for (const key of [...url.searchParams.keys()])
    if (NON_CANONICAL_PARAMS.test(key)) url.searchParams.delete(key);
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  const search = url.searchParams.toString();
  return `${origin}${pathname}${search ? `?${search}` : ""}`;
}

/** An absolute URL for an image or path (already-absolute URLs are kept). */
export function absoluteUrl(src: string | null | undefined, origin: string | null): string | null {
  if (!src || src.startsWith("data:")) return null;
  if (/^https?:\/\//i.test(src)) return src;
  return origin ? `${origin}${src.startsWith("/") ? src : `/${src}`}` : null;
}

/** Cut at a word boundary and end with "…" when longer than `max`. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, "")}…`;
}

/**
 * "{name}{suffix}" within 60 characters: the name is shortened, never the
 * suffix (e.g. " – Nike | Saloree"). A suffix too long for any name is dropped
 * to " | Saloree".
 */
export function seoTitle(name: string, suffix = ` | ${SITE_NAME}`): string {
  const room = TITLE_MAX - suffix.length;
  if (room < 12) return seoTitle(name, ` | ${SITE_NAME}`);
  return `${clip(name, room)}${suffix}`;
}

/**
 * A 120–160 character description from real sentences: the first that fit,
 * topped up with the following ones (e.g. "Sold by X on Saloree."), clipped
 * at 160.
 */
export function seoDescription(...parts: (string | null | undefined)[]): string {
  let out = "";
  for (const raw of parts) {
    const p = raw?.replace(/\s+/g, " ").trim();
    if (!p) continue;
    const sentence = /[.!?…]$/.test(p) ? p : `${p}.`;
    out = out ? `${out} ${sentence}` : sentence;
    if (out.length >= DESCRIPTION_MIN) break;
  }
  return clip(out, DESCRIPTION_MAX);
}

/** Open Graph locale for <html lang>. */
const OG_LOCALES: Record<string, string> = {
  en: "en_US",
  de: "de_DE",
  es: "es_ES",
  pt: "pt_PT",
  fi: "fi_FI",
  ar: "ar_AR",
  he: "he_IL",
  ko: "ko_KR",
  "zh-Hans": "zh_CN",
  "zh-Hant": "zh_TW",
};
export const ogLocale = (locale: Locale | string) => OG_LOCALES[locale] ?? "en_US";

export const NOINDEX = { name: "robots", content: "noindex, follow" } as const;

type Meta = Record<string, string>;
export interface PageSeo {
  title: string;
  description: string;
  /** Path on the main site, e.g. "/product/blue-mug". */
  path: string;
  origin: string | null;
  image?: string | null | undefined;
  imageAlt?: string | undefined;
  type?: "website" | "product";
  noindex?: boolean;
  /** Extra tags, e.g. product:price:amount. */
  extra?: Meta[];
  /** JSON-LD objects (each becomes one <script type="application/ld+json">). */
  jsonLd?: object[];
}

/** The meta tags and links of a public page (title, description, canonical, OG, Twitter, JSON-LD). */
export function pageHead(p: PageSeo) {
  const canonical = canonicalFor(p.path, p.origin);
  const image = absoluteUrl(p.image, p.origin) ?? absoluteUrl(OG_DEFAULT_IMAGE, p.origin);
  const meta: MetaTag[] = [
    { title: p.title },
    { name: "description", content: p.description },
    { property: "og:title", content: p.title },
    { property: "og:description", content: p.description },
    { property: "og:type", content: p.type ?? "website" },
    { property: "og:site_name", content: SITE_NAME },
    ...(canonical ? [{ property: "og:url", content: canonical }] : []),
    ...(image ? [{ property: "og:image", content: image }] : []),
    ...(image && p.imageAlt ? [{ property: "og:image:alt", content: p.imageAlt }] : []),
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: p.title },
    { name: "twitter:description", content: p.description },
    ...(image ? [{ name: "twitter:image", content: image }] : []),
    ...(p.noindex ? [NOINDEX] : []),
    ...(p.extra ?? []),
    ...(p.jsonLd ?? []).map(jsonLdMeta),
  ];
  return {
    meta,
    links: canonical && !p.noindex ? [{ rel: "canonical", href: canonical }] : [],
  };
}

// ---------------------------------------------------------------------------
// JSON-LD (schema.org), true data only
// ---------------------------------------------------------------------------
export function organizationLd(o: {
  origin: string;
  logo: string;
  legalName?: string | null;
  sameAs: string[];
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${o.origin}/#organization`,
    name: SITE_NAME,
    legalName: o.legalName || LEGAL_NAME,
    url: `${o.origin}/`,
    logo: absoluteUrl(o.logo, o.origin),
    ...(o.sameAs.length ? { sameAs: o.sameAs } : {}),
  };
}

/** The site search really is /products?q=… */
export function websiteLd(origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${origin}/#website`,
    name: SITE_NAME,
    url: `${origin}/`,
    publisher: { "@id": `${origin}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${origin}/products?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

export function breadcrumbLd(items: { name: string; path: string }[], origin: string) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: canonicalFor(it.path, origin),
    })),
  };
}

export interface ProductLdInput {
  id: string;
  title: string;
  description: string;
  images: string[];
  price: number;
  currency?: string;
  stock: number;
  brand?: string | null;
  path: string;
  store?: { name: string; path: string } | null;
  /** Only real reviews: when absent or 0, no rating is added. */
  rating?: number;
  reviews?: number;
}

export function productLd(p: ProductLdInput, origin: string) {
  const url = canonicalFor(p.path, origin);
  const images = p.images.map((i) => absoluteUrl(i, origin)).filter((i): i is string => !!i);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.title,
    ...(images.length ? { image: images } : {}),
    ...(p.description ? { description: clip(p.description, 5000) } : {}),
    sku: p.id,
    productID: p.id,
    ...(p.brand ? { brand: { "@type": "Brand", name: p.brand } } : {}),
    offers: {
      "@type": "Offer",
      url,
      price: p.price.toFixed(2),
      priceCurrency: p.currency ?? "USD",
      availability: p.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      ...(p.store
        ? {
            seller: {
              "@type": "Organization",
              name: p.store.name,
              url: canonicalFor(p.store.path, origin),
            },
          }
        : {}),
    },
    ...((p.reviews ?? 0) > 0 && (p.rating ?? 0) > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: p.rating,
            reviewCount: p.reviews,
          },
        }
      : {}),
  };
}

export function storeLd(
  s: {
    name: string;
    description?: string | null | undefined;
    path: string;
    image?: string | null | undefined;
    logo?: string | null | undefined;
  },
  origin: string,
) {
  const logo = absoluteUrl(s.logo, origin);
  const image = absoluteUrl(s.image, origin);
  return {
    "@context": "https://schema.org",
    "@type": "Store",
    name: s.name,
    url: canonicalFor(s.path, origin),
    ...(s.description ? { description: s.description } : {}),
    ...(logo ? { logo } : {}),
    ...(image ? { image } : {}),
    parentOrganization: { "@id": `${origin}/#organization` },
  };
}

/** A category page: the products it shows first, in that order. */
export function collectionLd(
  c: { name: string; path: string; items: { name: string; path: string }[] },
  origin: string,
) {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: c.name,
    url: canonicalFor(c.path, origin),
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: c.items.length,
      itemListElement: c.items.map((it, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: it.name,
        url: canonicalFor(it.path, origin),
      })),
    },
  };
}
