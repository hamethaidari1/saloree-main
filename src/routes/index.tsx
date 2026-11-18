import { useTranslation } from "react-i18next";
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
import { HomeEmpty, MoreForYou, Shelf } from "@/components/marketplace/home-shelves";
import {
  allForYou,
  categoryShelves,
  MIN_NEW_IN_SHELF,
  newArrivals,
  popular,
} from "@/lib/home-sections";
export const Route = createFileRoute("/")({
  head: ({ matches }) => {
    // On a store's own site the home page is that store.
    const store = storeFromMatches(matches);
    if (store) {
      const description =
        store.description || headT(matches)("meta.storeDescription", { store: store.name });
      return {
        meta: [
          { title: store.name },
          { name: "description", content: description },
          { property: "og:title", content: store.name },
          { property: "og:description", content: description },
          { property: "og:type", content: "website" },
        ],
      };
    }
    const t = headT(matches, "home");
    return {
      meta: [
        { title: t("meta.title") },
        { name: "description", content: t("meta.description") },
        { property: "og:title", content: t("meta.ogTitle") },
        { property: "og:description", content: t("meta.ogDescription") },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(catalogQuery),
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
              <img key={p.id} src={p.image} alt={p.title} width="384" height="512" loading="lazy" />
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
    </main>
  );
}
