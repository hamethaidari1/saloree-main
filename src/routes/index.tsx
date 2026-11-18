import { useTranslation } from "react-i18next";
import { thumbOrFull, thumbUrl } from "@/lib/image-optimize";
import { headT } from "@/i18n/head";
import { useCategoryName } from "@/i18n/hooks";
import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import { StoreHome } from "@/components/marketplace/storefront";
import { CategoryGrid } from "@/components/marketplace/category-grid";
import { storeFromMatches } from "@/lib/store-mode";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { catalogQuery } from "@/services/catalog";
import {
  StoreCard,
  SectionHeading,
  TrustStrip,
  CatalogSkeleton,
} from "@/components/marketplace/shared";
import { HeroCarousel } from "@/components/marketplace/hero-carousel";
import { HERO_SIZES, HERO_SLIDES } from "@/data/hero-slides";
import { organizationLd, pageHead, websiteLd } from "@/lib/seo";
import { origin, storeSeo } from "@/lib/seo-pages";
import { siteVerificationQuery } from "@/lib/site-verification";
import { footerQuery } from "@/services/site";
import { HomeEmpty, MoreForYou, Shelf } from "@/components/marketplace/home-shelves";
import {
  allForYou,
  categoryShelves,
  MIN_NEW_IN_SHELF,
  newArrivals,
  popular,
} from "@/lib/home-sections";
export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    const [catalog, footer, verification] = await Promise.all([
      context.queryClient.ensureQueryData(catalogQuery),
      // Real links for the Organization data; a failure just leaves them out.
      context.storeSlug ? null : context.queryClient.ensureQueryData(footerQuery).catch(() => null),
      context.storeSlug
        ? null
        : context.queryClient.ensureQueryData(siteVerificationQuery).catch(() => null),
    ]);
    return { catalog, footer, verification };
  },
  head: ({ matches, loaderData }) => {
    // On a store's own site the home page is that store: same tags as /store/<slug>.
    const store = storeFromMatches(matches);
    if (store) return storeSeo(store, matches);
    const t = headT(matches, "home");
    const o = origin();
    const head = pageHead({
      title: t("meta.title"),
      description: t("meta.description"),
      path: "/",
      origin: o,
      imageAlt: "Saloree",
      jsonLd: o
        ? [
            organizationLd({
              origin: o,
              logo: "/logo.png",
              legalName: loaderData?.footer?.company.legalName ?? null,
              // The footer's own Instagram / TikTok links.
              sameAs: (loaderData?.footer?.social ?? []).map((s) => s.url),
            }),
            websiteLd(o),
          ]
        : [],
    });
    // The first hero photo is the largest thing on the first screen: fetch it early.
    const first = HERO_SLIDES[0];
    const heroPreload =
      first?.kind === "image"
        ? [
            {
              rel: "preload",
              as: "image",
              href: first.image.src,
              imageSrcSet: first.image.srcSet,
              imageSizes: HERO_SIZES,
              fetchPriority: "high" as const,
            },
          ]
        : [];
    return {
      links: [...head.links, ...heroPreload],
      meta: [
        ...head.meta,
        // Open Graph keeps its own, shorter wording.
        { property: "og:title", content: t("meta.ogTitle") },
        { property: "og:description", content: t("meta.ogDescription") },
        ...(loaderData?.verification
          ? [{ name: "google-site-verification", content: loaderData.verification }]
          : []),
      ],
    };
  },
  pendingComponent: CatalogSkeleton,
  component: Home,
});
function Home() {
  const { store, theme } = useLoaderData({ from: "__root__" });
  const {
    data: { products, categories },
  } = useSuspenseQuery(catalogQuery);
  if (store)
    return <StoreHome store={store} products={products} categories={categories} theme={theme} />;
  return <MarketplaceHome />;
}
function MarketplaceHome() {
  const {
    data: { products, categories, stores },
  } = useSuspenseQuery(catalogQuery);
  const { t } = useTranslation("home");
  const categoryName = useCategoryName();
  // Built from the cached catalog: no extra requests for the shelves.
  const shelves = useMemo(() => {
    const fresh = newArrivals(products);
    const hot = popular(products);
    const seen = new Set([...fresh, ...hot].map((p) => p.id));
    // A category shelf must add products the shelves above didn't show.
    const byCategory = categoryShelves(products, categories, undefined, undefined, seen).filter(
      (s) => s.unseen >= MIN_NEW_IN_SHELF,
    );
    for (const s of byCategory) for (const p of s.products) seen.add(p.id);
    // "More for you" only when there is something beyond the shelves above.
    const more = products.some((p) => !seen.has(p.id)) ? allForYou(products, seen) : [];
    return { fresh, popular: hot, byCategory, more };
  }, [products, categories]);
  const [firstCategories, laterCategories] = [
    shelves.byCategory.slice(0, 2),
    shelves.byCategory.slice(2),
  ];
  const editImages = [products[4], products[7]].filter((p) => !!p);
  const categoryShelf = ({ category, products: list }: (typeof shelves.byCategory)[number]) => {
    const title = categoryName(category.slug, category.name);
    return (
      <Shelf
        key={category.slug}
        id={`category-${category.slug}`}
        title={title}
        products={list}
        link={(children, label) => (
          <Link to="/category/$slug" params={{ slug: category.slug }} aria-label={label}>
            {children}
          </Link>
        )}
      />
    );
  };
  return (
    <main className="market-container home-page">
      <HeroCarousel />
      <TrustStrip />
      <section className="market-section">
        <SectionHeading title={t("categories.title")} subtitle={t("categories.subtitle")} />
        <CategoryGrid categories={categories} />
      </section>
      {!products.length && <HomeEmpty />}
      <Shelf
        id="new"
        title={t("shelves.newTitle")}
        subtitle={t("shelves.newSubtitle")}
        products={shelves.fresh}
        eager
        link={(children, label) => (
          <Link to="/products" search={{ sort: "newest" }} aria-label={label}>
            {children}
          </Link>
        )}
      />
      <Shelf
        id="popular"
        title={t("shelves.popularTitle")}
        subtitle={t("shelves.popularSubtitle")}
        products={shelves.popular}
        link={(children, label) => (
          <Link to="/products" search={{ sort: "popular" }} aria-label={label}>
            {children}
          </Link>
        )}
      />
      {firstCategories.map(categoryShelf)}
      {editImages.length === 2 && (
        <section className="editorial-band">
          <div className="editorial-copy">
            <span className="eyebrow">{t("edit.eyebrow")}</span>
            <h2>{t("edit.title")}</h2>
            <p>{t("edit.text")}</p>
            <Button asChild variant="outline">
              <Link to="/category/$slug" params={{ slug: "home-kitchen" }}>
                {t("edit.cta")}
                <ArrowRight className="rtl:-scale-x-100" />
              </Link>
            </Button>
          </div>
          <div className="editorial-image">
            {editImages.map((p) => (
              <img
                key={p.id}
                src={thumbUrl(p.image)}
                onError={thumbOrFull(p.image)}
                alt={p.title}
                width="384"
                height="512"
                loading="lazy"
              />
            ))}
          </div>
        </section>
      )}
      {laterCategories.map(categoryShelf)}
      {stores.length > 0 && (
        <section className="market-section">
          <SectionHeading title={t("stores.title")} subtitle={t("stores.subtitle")} to="/stores" />
          <div className="store-grid store-grid-scroll">
            {stores.map((s) => (
              <StoreCard key={s.slug} store={s} />
            ))}
          </div>
        </section>
      )}
      <MoreForYou products={shelves.more} />
      <section className="market-section home-about" aria-labelledby="home-about-title">
        <h2 id="home-about-title">{t("about.title")}</h2>
        <p>{t("about.text")}</p>
      </section>
    </main>
  );
}
