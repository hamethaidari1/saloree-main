import { useTranslation } from "react-i18next";
import { headT } from "@/i18n/head";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronRight, ArrowRight, Truck, ShieldCheck, Heart, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSuspenseQuery } from "@tanstack/react-query";
import { catalogQuery, catalogService } from "@/services/catalog";
import { useFormat } from "@/i18n/hooks";
import { useCart } from "@/components/marketplace/cart-context";
import { StoreAddressLink, StoreLink } from "@/components/marketplace/store-link";
import { storeFromMatches, useStoreSlug } from "@/lib/store-mode";
import {
  Rating,
  QuantityPicker,
  ProductCard,
  SectionHeading,
  CatalogSkeleton,
} from "@/components/marketplace/shared";
export const Route = createFileRoute("/product/$id")({
  loader: async ({ params, context }) => {
    const [product] = await Promise.all([
      catalogService.getProduct(params.id),
      context.queryClient.ensureQueryData(catalogQuery),
    ]);
    // A store's own site only shows that store's products.
    if (!product || (context.storeSlug && product.storeSlug !== context.storeSlug))
      throw notFound();
    return product;
  },
  head: ({ loaderData, matches }) => {
    const t = headT(matches, "product");
    const title = t("titleWithSite", {
      ns: "common",
      title: loaderData?.title ?? t("meta.fallbackTitle"),
      site: storeFromMatches(matches)?.name ?? "Saloree",
    });
    return {
      meta: [
        { title },
        { name: "description", content: loaderData?.description || t("meta.description") },
        { property: "og:title", content: title },
        { property: "og:description", content: loaderData?.description || t("meta.ogDescription") },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  pendingComponent: CatalogSkeleton,
  component: ProductPage,
});
function ProductPage() {
  const p = Route.useLoaderData();
  return <ProductDetail key={p.id} product={p} />;
}
function ProductDetail({ product: p }: { product: import("@/data/catalog").Product }) {
  const {
    data: { stores, products },
  } = useSuspenseQuery(catalogQuery);
  const { t } = useTranslation("product");
  const format = useFormat();
  const store = stores.find((s) => s.slug === p.storeSlug);
  const storeSlug = useStoreSlug();
  const [quantity, setQuantity] = useState(1);
  const [view, setView] = useState("full");
  const { add } = useCart();
  const related = products
    .filter(
      (item) =>
        item.id !== p.id &&
        (storeSlug ? item.storeSlug === storeSlug : item.category === p.category),
    )
    .slice(0, 4);
  return (
    <main className="market-container">
      <div className="breadcrumb">
        <Link to="/">{t("home", { ns: "common" })}</Link>
        <ChevronRight className="rtl:-scale-x-100" />
        <Link to="/products">{t("allProducts")}</Link>
        <ChevronRight className="rtl:-scale-x-100" />
        <span>{p.title}</span>
      </div>
      <section className="product-detail">
        <div>
          <div className="detail-photo">
            <img
              src={p.image}
              alt={view === "detail" ? t("detailImageAlt", { title: p.title }) : p.title}
              width="384"
              height="512"
              className={view === "detail" ? "scale-125" : ""}
              fetchPriority="high"
            />
          </div>
          <div className="detail-thumbnails">
            {["full", "detail"].map((v) => (
              <Button
                key={v}
                variant="outline"
                aria-label={v === "full" ? t("fullView") : t("detailView")}
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={view === v ? "border-primary" : ""}
              >
                <img
                  src={p.image}
                  alt={v === "full" ? t("fullViewAlt") : t("detailAlt")}
                  className={v === "detail" ? "scale-150" : ""}
                  width="72"
                  height="72"
                />
              </Button>
            ))}
          </div>
        </div>
        <div className="detail-copy">
          <StoreLink slug={p.storeSlug} className="text-xs text-primary">
            {store?.name}
          </StoreLink>
          <h1>{p.title}</h1>
          <Rating rating={p.rating} reviews={p.reviews} />
          <div className="detail-price">
            {format.price(p.price)}
            {p.originalPrice && <span className="old-price">{format.price(p.originalPrice)}</span>}
          </div>
          <p className="detail-description" dir="auto">
            {p.description}
          </p>
          <span className="stock-indicator">
            {p.stock > 0 ? t("inStock", { count: p.stock }) : t("outOfStock")}
          </span>
          <div className="purchase-row">
            <QuantityPicker value={quantity} max={p.stock} onChange={setQuantity} />
            <Button
              className="add-button"
              disabled={p.stock < 1}
              onClick={() => add(p.id, quantity)}
            >
              <PlusBag />
              {t("addToCart")}
              <ArrowRight className="rtl:-scale-x-100" />
            </Button>
          </div>
          <div className="detail-perks">
            <span>
              <Truck className="rtl:-scale-x-100" />
              {t("perkPacked")}
            </span>
            <span>
              <ShieldCheck />
              {t("perkQuality")}
            </span>
          </div>
          {/* On the store's own site the shopper is already "in" the store. */}
          {!storeSlug && (
            <div className="seller-box">
              <span className="store-avatar">{store?.initials}</span>
              <div className="min-w-0 flex-1">
                <p>{t("soldBy")}</p>
                <StoreLink slug={p.storeSlug}>{store?.name}</StoreLink>
                <StoreAddressLink slug={p.storeSlug} />
                <Rating rating={store?.rating ?? 0} />
              </div>
              <Button asChild variant="outline" size="sm">
                <StoreLink slug={p.storeSlug}>
                  {t("visitStore")}
                  <ArrowRight className="rtl:-scale-x-100" />
                </StoreLink>
              </Button>
            </div>
          )}
        </div>
      </section>
      {/* Hidden until a reviews table exists; the sample reviews would otherwise appear on real products. */}
      <section className="reviews-section" hidden={!(p.reviews > 0)}>
        <h2 className="text-xl font-semibold">{t("reviewsTitle")}</h2>
        <div className="reviews-layout">
          <div>
            <strong className="text-4xl font-semibold">
              {format.number(p.rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            </strong>
            <Rating rating={p.rating} reviews={p.reviews} />
            <p className="text-xs text-muted-foreground mt-3">{t("customerReviews")}</p>
          </div>
          <div>
            {[
              {
                name: "Emma R.",
                text: "Such a lovely find. The quality feels great, and it looks just as beautiful in person.",
              },
              {
                name: "Daniel M.",
                text: "Thoughtfully made and carefully packed. A wonderful addition to my everyday routine.",
              },
            ].map((r) => (
              <div key={r.name} className="review-entry">
                <strong>{r.name}</strong>
                <small>{t("sampleReview")}</small>
                <Rating rating={5} />
                <p>{r.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="market-section all-products">
        <SectionHeading title={t("related")} />
        <div className="product-grid">
          {related.map((item) => (
            <ProductCard key={item.id} product={item} />
          ))}
        </div>
      </section>
    </main>
  );
}
function PlusBag() {
  return <Heart size={16} />;
}
