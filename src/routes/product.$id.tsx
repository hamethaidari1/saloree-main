import { useTranslation } from "react-i18next";
import { headT } from "@/i18n/head";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { ChevronRight, ArrowRight, Truck, ShieldCheck, ShoppingBag, Zap } from "lucide-react";
import { ProductDescription } from "@/components/marketplace/product-description";
import { buyNowQuantity } from "@/lib/buy-now";
import { descriptionText } from "@/lib/rich-text";
import { WishlistButton } from "@/components/marketplace/wishlist-button";
import { Button } from "@/components/ui/button";
import { useSuspenseQuery } from "@tanstack/react-query";
import { catalogQuery, catalogService, imagesOf } from "@/services/catalog";
import { ProductGallery } from "@/components/marketplace/product-gallery";
import { useFormat } from "@/i18n/hooks";
import { OptionPicker } from "@/components/marketplace/product-options";
import { missingMessageKey, missingOptions } from "@/lib/product-options";
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
        // Plain text: the description's Markdown ("#", "**", "- ") never reaches the tags.
        {
          name: "description",
          content: descriptionText(loaderData?.description) || t("meta.description"),
        },
        { property: "og:title", content: title },
        {
          property: "og:description",
          content: descriptionText(loaderData?.description) || t("meta.ogDescription"),
        },
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
  const [color, setColor] = useState<string | null>(null);
  const [size, setSize] = useState<string | null>(null);
  // "Please select…" shows after a try without the required choice.
  const [tried, setTried] = useState(false);
  const missing = missingOptions(p, { color, size });
  const showMissing = tried && missing.length > 0;
  const { add } = useCart();
  const navigate = useNavigate();
  // One click: a second click (or Enter held down) does nothing.
  const [leaving, setLeaving] = useState(false);
  const leavingRef = useRef(false);
  /**
   * Checks out only this product, with this quantity. Nothing is added to the
   * bag. Signed out, the checkout's guard sends the visitor to sign-in and back.
   */
  /** False (and the message shows) while a required color/size is not chosen. */
  const chosen = () => {
    setTried(true);
    if (!missing.length) return true;
    document.getElementById("product-options-error")?.focus();
    return false;
  };
  const addToBag = () => {
    if (chosen()) add(p.id, quantity, { color, size });
  };
  const buyNow = () => {
    if (leavingRef.current || p.stock < 1 || !chosen()) return;
    leavingRef.current = true;
    setLeaving(true);
    void navigate({
      to: "/checkout",
      search: {
        buy: p.id,
        qty: buyNowQuantity(quantity, p.stock),
        ...(color ? { color } : {}),
        ...(size ? { size } : {}),
      },
    }).finally(() => {
      leavingRef.current = false;
      setLeaving(false);
    });
  };
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
        <ProductGallery title={p.title} images={imagesOf(p)} />
        <div className="detail-copy">
          <StoreLink slug={p.storeSlug} className="text-xs text-primary">
            {store?.name}
          </StoreLink>
          <h1>{p.title}</h1>
          {p.brand && (
            <Link
              to="/products"
              search={{ brand: p.brand }}
              className="product-brand-link"
              aria-label={t("options.brandLink", { brand: p.brand })}
            >
              <span dir="auto">{p.brand}</span>
            </Link>
          )}
          <Rating rating={p.rating} reviews={p.reviews} />
          <div className="detail-price">
            {format.price(p.price)}
            {p.originalPrice && <span className="old-price">{format.price(p.originalPrice)}</span>}
          </div>
          <ProductDescription text={p.description} />
          <span className="stock-indicator" id="product-stock">
            {p.stock > 0 ? t("inStock", { count: p.stock }) : t("outOfStock")}
          </span>
          {(!!p.colors?.length || !!p.sizes?.length) && (
            <div className="product-options">
              {!!p.colors?.length && (
                <OptionPicker
                  kind="color"
                  values={p.colors}
                  value={color}
                  onChange={setColor}
                  invalid={showMissing && missing.includes("color")}
                  errorId="product-options-error"
                />
              )}
              {!!p.sizes?.length && (
                <OptionPicker
                  kind="size"
                  values={p.sizes}
                  value={size}
                  onChange={setSize}
                  invalid={showMissing && missing.includes("size")}
                  errorId="product-options-error"
                />
              )}
              {showMissing && (
                <p
                  id="product-options-error"
                  className="option-error"
                  role="alert"
                  tabIndex={-1}
                  data-testid="options-error"
                >
                  {t(missingMessageKey(missing))}
                </p>
              )}
            </div>
          )}
          <div className="purchase-row">
            <QuantityPicker value={quantity} max={p.stock} onChange={setQuantity} />
            <Button
              variant="outline"
              className="add-button"
              disabled={p.stock < 1}
              onClick={addToBag}
            >
              <ShoppingBag size={16} aria-hidden />
              {t("addToCart")}
            </Button>
            <Button
              className="buy-now-button"
              disabled={p.stock < 1 || leaving}
              aria-describedby={p.stock < 1 ? "product-stock" : undefined}
              onClick={buyNow}
            >
              <Zap size={16} aria-hidden />
              {t("buyNow")}
              <ArrowRight className="rtl:-scale-x-100" />
            </Button>
            <WishlistButton productId={p.id} title={p.title} className="detail-heart" />
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
