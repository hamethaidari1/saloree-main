import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  ShoppingBag,
  Heart,
  Star,
  Plus,
  Minus,
  ShieldCheck,
  PackageCheck,
  Store as StoreIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Logo } from "./logo";
import { useQuery } from "@tanstack/react-query";
import type { Catalog, Product, Store } from "@/data/catalog";
import { catalogQuery } from "@/services/catalog";
import { useFormat } from "@/i18n/hooks";
import { useCart } from "./cart-context";
import { StoreAddressLink, StoreLink } from "./store-link";
import { SiteFooter } from "./footer";
const EMPTY_CATALOG: Catalog = { products: [], stores: [], categories: [] };
/** Non-suspending catalog access for layout pieces that render on every page. */
export function useCatalog(): Catalog {
  return useQuery(catalogQuery).data ?? EMPTY_CATALOG;
}
/** The site header lives in ./header; re-exported under its old name for the root layout. */
export { SiteHeader as Navbar } from "./header/site-header";
/** Marketplace footer (see ./footer); a store's own site uses StoreFooter instead. */
export function Footer() {
  const { categories } = useCatalog();
  return <SiteFooter categories={categories} />;
}
export function TrustStrip() {
  const { t } = useTranslation("home");
  return (
    <div className="trust-strip">
      {[
        { icon: StoreIcon, title: t("trust.storesTitle"), text: t("trust.storesText") },
        { icon: ShieldCheck, title: t("trust.confidenceTitle"), text: t("trust.confidenceText") },
        { icon: PackageCheck, title: t("trust.cartTitle"), text: t("trust.cartText") },
        { icon: Heart, title: t("trust.personalTitle"), text: t("trust.personalText") },
      ].map(({ icon: Icon, title, text }) => (
        <div className="trust-item" key={title}>
          <Icon />
          <div>
            <strong>{title}</strong>
            <p>{text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
export function SectionHeading({
  title,
  subtitle,
  to = "/products",
  children,
}: {
  title: string;
  subtitle?: string;
  to?: "/products" | "/stores";
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="section-heading">
      <div className="min-w-0">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children ?? (
        <Link to={to}>
          {t("viewAll")}
          <ArrowRight size={13} className="rtl:-scale-x-100" />
        </Link>
      )}
    </div>
  );
}
export function Rating({ rating, reviews }: { rating: number; reviews?: number }) {
  const format = useFormat();
  if (!(rating > 0)) return null;
  return (
    <span className="product-rating">
      <Star />
      <span>{format.number(rating, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
      {reviews !== undefined && <span className="review-count">({format.number(reviews)})</span>}
    </span>
  );
}
export function ProductCard({ product }: { product: Product }) {
  const store = useCatalog().stores.find((s) => s.slug === product.storeSlug);
  const { t } = useTranslation("product");
  const format = useFormat();
  const { add } = useCart();
  const [saved, setSaved] = useState(false);
  return (
    <article className="product-card">
      <div className="product-photo">
        {product.badge && (
          <span className={`product-badge ${product.badge.toLowerCase()}`}>
            {t(`badge.${product.badge.toLowerCase()}`, { defaultValue: product.badge })}
          </span>
        )}
        <Link
          to="/product/$id"
          params={{ id: product.id }}
          aria-label={t("card.view", { title: product.title })}
        >
          <img src={product.image} alt={product.title} width="384" height="512" loading="lazy" />
        </Link>
        <Button
          size="icon"
          variant="ghost"
          className={`product-save ${saved ? "text-brand" : ""}`}
          aria-label={t(saved ? "card.unsave" : "card.save", { title: product.title })}
          aria-pressed={saved}
          title={t(saved ? "card.unsaveTitle" : "card.saveTitle")}
          onClick={() => {
            setSaved(!saved);
            toast.success(t(saved ? "card.removed" : "card.saved"));
          }}
        >
          <Heart size={15} fill={saved ? "currentColor" : "none"} />
        </Button>
      </div>
      <div className="product-info">
        <StoreLink slug={product.storeSlug} className="product-store">
          {store?.name}
        </StoreLink>
        <Link to="/product/$id" params={{ id: product.id }} className="product-title">
          {product.title}
        </Link>
        <Rating rating={product.rating} reviews={product.reviews} />
        <div className="product-bottom">
          <span className="product-price">
            {format.price(product.price)}
            {product.originalPrice && (
              <span className="old-price">{format.price(product.originalPrice)}</span>
            )}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="product-cart"
            title={t("card.addTitle")}
            aria-label={t("card.addAria", { title: product.title })}
            onClick={() => add(product.id)}
          >
            <Plus size={14} />
          </Button>
        </div>
      </div>
    </article>
  );
}
export { StoreCard } from "./store-card";
export function QuantityPicker({
  value,
  onChange,
  max,
}: {
  value: number;
  onChange: (q: number) => void;
  max: number;
}) {
  const { t } = useTranslation();
  const format = useFormat();
  return (
    <div className="quantity-picker">
      <Button
        size="icon"
        variant="ghost"
        aria-label={t("decreaseQuantity")}
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={13} />
      </Button>
      <span aria-label={t("quantity")} aria-live="polite">
        {format.number(value)}
      </span>
      <Button
        size="icon"
        variant="ghost"
        aria-label={t("increaseQuantity")}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={13} />
      </Button>
    </div>
  );
}
export function EmptyState({ title, description }: { title: string; description: string }) {
  const { t } = useTranslation();
  return (
    <div className="empty-state">
      <ShoppingBag />
      <h2>{title}</h2>
      <p>{description}</p>
      <Button asChild>
        <Link to="/products">
          {t("exploreProducts")}
          <ArrowRight className="rtl:-scale-x-100" />
        </Link>
      </Button>
    </div>
  );
}
export function CatalogSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="market-container skeleton-grid" aria-label={t("loadingProducts")}>
      {Array.from({ length: 8 }, (_, i) => (
        <div className="skeleton-product" key={i} />
      ))}
    </div>
  );
}
