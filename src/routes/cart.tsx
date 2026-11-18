import { useTranslation } from "react-i18next";
import { thumbOrFull, thumbUrl } from "@/lib/image-optimize";
import { productParam } from "@/services/catalog";
import { SelectedOptions } from "@/components/marketplace/product-options";
import { lineKey, lineMax } from "@/services/cart";
import { headT } from "@/i18n/head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight, Trash2, Store, ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCart } from "@/components/marketplace/cart-context";
import { cartTotal } from "@/services/cart";
import { useFormat } from "@/i18n/hooks";
import {
  QuantityPicker,
  EmptyState,
  CatalogSkeleton,
  useCatalog,
} from "@/components/marketplace/shared";
import { toast } from "sonner";
import { StoreLink } from "@/components/marketplace/store-link";
import { mainSiteUrl } from "@/lib/host";
import { useStoreSlug } from "@/lib/store-mode";
export const Route = createFileRoute("/cart")({
  head: ({ matches }) => {
    const t = headT(matches, "cart");
    return {
      meta: [
        { name: "robots", content: "noindex, follow" },
        { title: t("meta.title") },
        { name: "description", content: t("meta.description") },
        { property: "og:title", content: t("meta.title") },
        { property: "og:description", content: t("meta.ogDescription") },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  component: CartPage,
});
function CartPage() {
  const { t } = useTranslation("cart");
  const format = useFormat();
  const { items, ready, setQuantity } = useCart();
  const storeSlug = useStoreSlug();
  const { stores, products } = useCatalog();
  const total = cartTotal(items, products);
  return (
    <main className="market-container">
      <div className="breadcrumb">
        <Link to="/">{t("home", { ns: "common" })}</Link>
        <ChevronRight className="rtl:-scale-x-100" />
        <span>{t("title")}</span>
      </div>
      <h1 className="page-title">{t("title")}</h1>
      <p className="page-subtitle">{t("subtitle")}</p>
      {!ready ? (
        <CatalogSkeleton />
      ) : !items.length ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyText")} />
      ) : (
        <div className="cart-layout">
          <div>
            {stores
              .filter((s) =>
                items.some((i) => products.find((p) => p.id === i.productId)?.storeSlug === s.slug),
              )
              .map((store) => (
                <section key={store.slug} className="cart-store-group">
                  <StoreLink slug={store.slug} className="cart-store-heading">
                    <Store size={16} />
                    {store.name}
                    <ChevronRight size={13} className="rtl:-scale-x-100" />
                  </StoreLink>
                  {items.map((item) => {
                    const p = products.find((p) => p.id === item.productId);
                    if (!p || p.storeSlug !== store.slug) return null;
                    return (
                      <article key={lineKey(item)} className="cart-line">
                        <Link to="/product/$id" params={{ id: productParam(p) }}>
                          <img
                            src={thumbUrl(p.image)}
                            onError={thumbOrFull(p.image)}
                            alt={p.title}
                            width="105"
                            height="105"
                          />
                        </Link>
                        <div className="min-w-0">
                          <Link to="/product/$id" params={{ id: productParam(p) }}>
                            <h3>{p.title}</h3>
                          </Link>
                          <SelectedOptions color={item.color} size={item.size} />
                          <p>{t("each", { price: format.price(p.price) })}</p>
                          <QuantityPicker
                            value={item.quantity}
                            // Stock is shared by all colors/sizes of the product.
                            max={lineMax(items, item, p.stock)}
                            onChange={(q) => setQuantity(item, q)}
                          />
                        </div>
                        <div className="cart-line-end">
                          <strong>{format.price(p.price * item.quantity)}</strong>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={t("remove", { title: p.title })}
                            title={t("removeTitle")}
                            onClick={() => {
                              setQuantity(item, 0);
                              toast.success(t("removed"));
                            }}
                          >
                            <Trash2 size={15} />
                          </Button>
                        </div>
                      </article>
                    );
                  })}
                </section>
              ))}
            <Link
              to="/products"
              className="text-xs inline-flex items-center gap-2 text-primary mt-3"
            >
              {t("continue")}
              <ArrowRight size={14} className="rtl:-scale-x-100" />
            </Link>
          </div>
          <aside className="order-summary">
            <h2>{t("summary")}</h2>
            <div className="summary-row">
              <span>
                {t("subtotalItems", { count: items.reduce((s, i) => s + i.quantity, 0) })}
              </span>
              <strong>{format.price(total)}</strong>
            </div>
            <div className="summary-row text-muted-foreground">
              <span>{t("shipping")}</span>
              <span>{t("shippingLater")}</span>
            </div>
            <div className="summary-row summary-total">
              <span>{t("subtotal")}</span>
              <span>{format.price(total)}</span>
            </div>
            <Button asChild className="w-full h-11 mt-4">
              {/* Checkout only runs on the main domain; the cart is shared with it. */}
              {storeSlug ? (
                <a href={mainSiteUrl("/checkout")}>
                  {t("toCheckout")}
                  <ArrowRight className="rtl:-scale-x-100" />
                </a>
              ) : (
                <Link to="/checkout">
                  {t("toCheckout")}
                  <ArrowRight className="rtl:-scale-x-100" />
                </Link>
              )}
            </Button>
            <p className="checkout-note">{t("note")}</p>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mt-5">
              <ShieldCheck size={14} />
              {t("trust")}
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}
