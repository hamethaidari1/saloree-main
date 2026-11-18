import { useTranslation } from "react-i18next";
import { productParam } from "@/services/catalog";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Heart, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { headT } from "@/i18n/head";
import { useFormat } from "@/i18n/hooks";
import { Button } from "@/components/ui/button";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { StoreLink } from "@/components/marketplace/store-link";
import { useCart } from "@/components/marketplace/cart-context";
import { wishlistErrorMessage } from "@/components/marketplace/wishlist-button";
import { requireAuth, useAuth } from "@/lib/auth";
import { wishlistKeys, useWishlistToggle } from "@/hooks/use-wishlist";
import { wishlistErrorKind, wishlistService, type WishlistItem } from "@/services/wishlist";

// Signed-in only (guests go to sign in and come back). Main domain only.
export const Route = createFileRoute("/wishlist")({
  ssr: false,
  beforeLoad: requireAuth(),
  head: ({ matches }) => ({
    meta: [
      { title: headT(matches, "product")("wishlist.metaTitle") },
      { name: "robots", content: "noindex" },
    ],
  }),
  pendingComponent: CatalogSkeleton,
  component: WishlistPage,
});

function WishlistPage() {
  const { t } = useTranslation("product");
  const format = useFormat();
  const { user } = useAuth();
  const query = useQuery({
    queryKey: wishlistKeys.items(user?.id),
    queryFn: wishlistService.list,
    enabled: !!user,
  });
  const items = query.data ?? [];

  return (
    <main className="market-container wishlist-page">
      <div className="wishlist-head">
        <h1 className="page-title">{t("wishlist.title")}</h1>
        {query.isSuccess && (
          <span
            className="wishlist-count"
            aria-label={t("wishlist.countAria", { count: items.length })}
          >
            {format.number(items.length)}
          </span>
        )}
      </div>

      {query.isPending ? (
        <div className="skeleton-grid" aria-busy="true" aria-label={t("wishlist.loading")}>
          {Array.from({ length: 4 }, (_, i) => (
            <div className="skeleton-product" key={i} />
          ))}
        </div>
      ) : query.isError ? (
        <div role="alert" className="wishlist-error">
          <p>{wishlistErrorMessage(t, query.error)}</p>
          <ErrorDetail error={query.error} />
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t("wishlist.retry")}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <Heart aria-hidden />
          <h2>{t("wishlist.emptyTitle")}</h2>
          <p>{t("wishlist.emptyText")}</p>
          <Button asChild>
            <Link to="/products">
              {t("wishlist.keepShopping")}
              <ArrowRight className="rtl:-scale-x-100" />
            </Link>
          </Button>
        </div>
      ) : (
        <ul className="wishlist-grid">
          {items.map((item) => (
            <WishlistCard key={item.productId} item={item} />
          ))}
        </ul>
      )}
    </main>
  );
}

/** The database's own code and message, for errors we don't have words for. */
function ErrorDetail({ error }: { error: unknown }) {
  const e = (error && typeof error === "object" ? error : {}) as {
    code?: unknown;
    message?: unknown;
  };
  // Unknown errors already show the database's message as the main text.
  if (!wishlistErrorKind(error)) return null;
  if (typeof e.code !== "string" || typeof e.message !== "string") return null;
  return (
    <p className="oauth-error-code" dir="ltr">
      <bdi>
        {e.message} ({e.code})
      </bdi>
    </p>
  );
}

function WishlistCard({ item }: { item: WishlistItem }) {
  const { t } = useTranslation("product");
  const format = useFormat();
  const { add, items: cartItems } = useCart();
  const remove = useWishlistToggle({
    onError: (error) => toast.error(wishlistErrorMessage(t, error)),
  });
  const p = item.product;
  const inCart = cartItems.find((i) => i.productId === p.id)?.quantity ?? 0;
  const out = p.stock < 1;
  const full = !out && inCart >= p.stock; // the cart already holds all there is

  return (
    <li className="wishlist-card" aria-busy={remove.isPending || undefined}>
      <Link
        to="/product/$id"
        params={{ id: productParam(p) }}
        className="wishlist-photo"
        tabIndex={-1}
      >
        <img src={p.image} alt="" width="384" height="512" loading="lazy" />
      </Link>
      <div className="wishlist-info">
        <StoreLink slug={p.storeSlug} className="product-store">
          {item.storeName}
        </StoreLink>
        <Link to="/product/$id" params={{ id: productParam(p) }} className="product-title">
          {p.title}
        </Link>
        <span className="product-price">
          {format.price(p.price)}
          {p.originalPrice && <span className="old-price">{format.price(p.originalPrice)}</span>}
        </span>
        <span className="wishlist-stock" data-out={out || undefined}>
          {out ? t("outOfStock") : t("inStock", { count: p.stock })}
        </span>
        <span className="wishlist-saved">
          {t("wishlist.savedOn", { date: format.date(item.savedAt, { dateStyle: "medium" }) })}
        </span>
        <div className="wishlist-actions">
          <Button
            size="sm"
            disabled={out || full}
            onClick={() => add(p.id)}
            aria-label={t("card.addAria", { title: p.title })}
          >
            <Plus size={14} aria-hidden />
            {out ? t("outOfStock") : full ? t("wishlist.allInCart") : t("addToCart")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutate(
                { productId: p.id, save: false },
                { onSuccess: () => toast.success(t("wishlist.removed")) },
              )
            }
            aria-label={t("wishlist.removeAria", { title: p.title })}
          >
            <Trash2 size={14} aria-hidden />
            {t("wishlist.remove")}
          </Button>
        </div>
      </div>
    </li>
  );
}
