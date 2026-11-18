/**
 * The head() of each public page type, from the data the page shows.
 * Pure builders live in ./seo; this file adds the language and the catalog.
 */
import type { QueryClient } from "@tanstack/react-query";
import type { Catalog, Category, Product, Store } from "@/data/catalog";
import { headT, i18nFromMatches } from "@/i18n/head";
import { DEFAULT_LOCALE } from "@/i18n/locales";
import { hostConfig } from "@/lib/host";
import { descriptionText } from "@/lib/rich-text";
import { storeFromMatches } from "@/lib/store-mode";
import { catalogQuery, productPath } from "@/services/catalog";
import {
  breadcrumbLd,
  canonicalFor,
  collectionLd,
  NOINDEX,
  ogLocale,
  pageHead,
  productLd,
  seoDescription,
  seoTitle,
  siteOrigin,
  SITE_NAME,
  storeLd,
} from "./seo";

type Matches = readonly { routeId: string; context?: unknown; loaderData?: unknown }[];

export const origin = () => siteOrigin(hostConfig().rootDomain);
const localeOf = (matches: Matches) => i18nFromMatches(matches)?.locale ?? DEFAULT_LOCALE;
const storePath = (slug: string) => `/store/${encodeURIComponent(slug)}`;
const categoryPath = (slug: string) => `/category/${encodeURIComponent(slug)}`;

/** The catalog the loaders put in the query cache (every public page loads it). */
function catalogFrom(matches: Matches): Catalog | null {
  for (const m of matches) {
    const qc = (m.context as { queryClient?: QueryClient } | undefined)?.queryClient;
    const data = qc?.getQueryData<Catalog>(catalogQuery.queryKey);
    if (data) return data;
  }
  return null;
}

export function productSeo(
  p: Product,
  matches: Matches,
  stores: Store[] = catalogFrom(matches)?.stores ?? [],
) {
  const t = headT(matches, "common");
  const store = stores.find((s) => s.slug === p.storeSlug) ?? storeFromMatches(matches);
  const o = origin();
  const path = productPath(p);
  const head = pageHead({
    title: seoTitle(p.title, p.brand ? ` – ${p.brand} | ${SITE_NAME}` : ` | ${SITE_NAME}`),
    // The product's own text (or, without one, its title), then who sells it.
    description: seoDescription(
      descriptionText(p.description) || p.title,
      store ? t("seo.productTail", { store: store.name }) : null,
    ),
    path,
    origin: o,
    image: p.image,
    imageAlt: p.title,
    type: "product",
    extra: [
      { property: "og:locale", content: ogLocale(localeOf(matches)) },
      { property: "product:price:amount", content: p.price.toFixed(2) },
      { property: "product:price:currency", content: "USD" },
      {
        property: "product:availability",
        content: p.stock > 0 ? "in stock" : "out of stock",
      },
    ],
    jsonLd: o
      ? [
          productLd(
            {
              id: p.id,
              title: p.title,
              description: descriptionText(p.description),
              images: p.images?.length ? p.images : [p.image],
              price: p.price,
              stock: p.stock,
              brand: p.brand ?? null,
              path,
              store: store ? { name: store.name, path: storePath(store.slug) } : null,
              rating: p.rating,
              reviews: p.reviews,
            },
            o,
          ),
          breadcrumbLd(
            [
              { name: t("home"), path: "/" },
              ...(store ? [{ name: store.name, path: storePath(store.slug) }] : []),
              { name: p.title, path },
            ],
            o,
          ),
        ]
      : [],
  });
  return head;
}

export function storeSeo(store: Store, matches: Matches) {
  const t = headT(matches, "common");
  const o = origin();
  const path = storePath(store.slug);
  return pageHead({
    title: seoTitle(store.name, t("seo.storeSuffix")),
    description: seoDescription(store.description, t("seo.storeTail", { store: store.name })),
    path,
    origin: o,
    image: store.banner ?? store.logo,
    imageAlt: store.name,
    extra: [{ property: "og:locale", content: ogLocale(localeOf(matches)) }],
    jsonLd: o
      ? [
          storeLd(
            {
              name: store.name,
              description: store.description,
              path,
              image: store.banner,
              logo: store.logo,
            },
            o,
          ),
          breadcrumbLd(
            [
              { name: t("home"), path: "/" },
              { name: t("seo.stores"), path: "/stores" },
              { name: store.name, path },
            ],
            o,
          ),
        ]
      : [],
  });
}

/** How many products a category page shows first (Browse: 9 per page, newest first). */
export const CATEGORY_PAGE_SIZE = 9;

/**
 * The marketplace category page. `visible` = the products it shows first
 * (same filter and order as the page); an empty category is noindex.
 */
export function categorySeo(
  category: Category,
  matches: Matches,
  visible: Product[] = categoryProducts(category.slug, catalogFrom(matches)?.products ?? []),
) {
  const t = headT(matches, "common");
  const name = headT(matches, "categories")(category.slug, { defaultValue: category.name });
  const o = origin();
  const path = categoryPath(category.slug);
  return pageHead({
    title: seoTitle(name, t("seo.categorySuffix")),
    description: seoDescription(t("seo.categoryDescription", { category: name })),
    path,
    origin: o,
    image: visible[0]?.image ?? category.image,
    imageAlt: name,
    noindex: visible.length === 0,
    extra: [{ property: "og:locale", content: ogLocale(localeOf(matches)) }],
    jsonLd:
      o && visible.length
        ? [
            collectionLd(
              {
                name,
                path,
                items: visible
                  .slice(0, CATEGORY_PAGE_SIZE)
                  .map((p) => ({ name: p.title, path: productPath(p) })),
              },
              o,
            ),
            breadcrumbLd(
              [
                { name: t("home"), path: "/" },
                { name, path },
              ],
              o,
            ),
          ]
        : [],
  });
}

/** The products the category page lists first: the category's, newest first, like Browse. */
export function categoryProducts(slug: string, products: Product[]) {
  return products
    .filter((p) => p.category === slug)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

/** Canonical + og:url for a listing (/products, /stores); filtered results are noindex, follow. */
export function listingExtras(path: string, filtered: boolean) {
  const o = origin();
  const canonical = canonicalFor(path, o);
  return {
    meta: [
      ...(filtered ? [NOINDEX] : []),
      ...(canonical && !filtered ? [{ property: "og:url", content: canonical }] : []),
      { property: "og:site_name", content: SITE_NAME },
    ],
    links: canonical && !filtered ? [{ rel: "canonical", href: canonical }] : [],
  };
}
