import { useTranslation } from "react-i18next";
import { headT } from "@/i18n/head";
import { useCategoryName } from "@/i18n/hooks";
import { createFileRoute, Link, useLoaderData } from "@tanstack/react-router";
import { StoreHome } from "@/components/marketplace/storefront";
import { CategoryGrid } from "@/components/marketplace/category-grid";
import { storeFromMatches } from "@/lib/store-mode";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { catalogQuery } from "@/services/catalog";
import {
  ProductCard,
  StoreCard,
  SectionHeading,
  TrustStrip,
  CatalogSkeleton,
} from "@/components/marketplace/shared";
import { HeroCarousel } from "@/components/marketplace/hero-carousel";
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
  const [category, setCategory] = useState("");
  return (
    <main className="market-container">
      <HeroCarousel />
      <TrustStrip />
      <section className="market-section">
        <SectionHeading title={t("categories.title")} subtitle={t("categories.subtitle")} />
        <CategoryGrid categories={categories} />
      </section>
      <section className="market-section">
        <SectionHeading title={t("featured.title")} subtitle={t("featured.subtitle")} />
        <div className="product-grid">
          {products.slice(0, 4).map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>
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
          <img
            src={products[4]?.image}
            alt={products[4]?.title ?? ""}
            width="384"
            height="512"
            loading="lazy"
          />
          <img
            src={products[7]?.image}
            alt={products[7]?.title ?? ""}
            width="384"
            height="512"
            loading="lazy"
          />
        </div>
      </section>
      <section className="market-section">
        <SectionHeading title={t("fresh.title")} subtitle={t("fresh.subtitle")}>
          <Link to="/products" search={{ sort: "newest" }}>
            {t("fresh.link")}
            <ArrowRight size={13} className="rtl:-scale-x-100" />
          </Link>
        </SectionHeading>
        <div className="product-grid">
          {products.slice(8, 12).map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>
      <section className="market-section">
        <SectionHeading title={t("stores.title")} subtitle={t("stores.subtitle")} to="/stores" />
        <div className="store-grid store-grid-scroll">
          {stores.map((s) => (
            <StoreCard key={s.slug} store={s} />
          ))}
        </div>
      </section>
      <section className="market-section all-products">
        <SectionHeading title={t("discover.title")} subtitle={t("discover.subtitle")} />
        <div className="category-tabs">
          <Button
            size="sm"
            variant={!category ? "default" : "ghost"}
            onClick={() => setCategory("")}
          >
            {t("discover.all")}
          </Button>
          {categories.map((c) => (
            <Button
              key={c.slug}
              size="sm"
              variant={category === c.slug ? "default" : "ghost"}
              onClick={() => setCategory(c.slug)}
            >
              {categoryName(c.slug, c.name)}
            </Button>
          ))}
        </div>
        <div className="product-grid">
          {products
            .filter((p) => !category || p.category === category)
            .slice(0, 8)
            .map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
        </div>
        <div className="text-center mt-8">
          <Button asChild variant="outline">
            <Link to="/products">
              {t("discover.more")}
              <ArrowRight className="rtl:-scale-x-100" />
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
