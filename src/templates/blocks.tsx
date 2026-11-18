import { useTranslation } from "react-i18next";
import { productParam } from "@/services/catalog";
/**
 * Building blocks shared by every store template. All content is the
 * store's real data; all styling comes from the scoped --tpl-* variables.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ImageOff, Plus, Store as StoreIcon } from "lucide-react";
import { useCart } from "@/components/marketplace/cart-context";
import { WishlistButton } from "@/components/marketplace/wishlist-button";
import { Rating } from "@/components/marketplace/shared";
import type { Category, Product, Store } from "@/data/catalog";
import { safeHttpsUrl } from "@/lib/tracking";
import { useCategoryName, useFormat } from "@/i18n/hooks";
import { loadFont } from "./fonts";
import { themeCssVars, type ThemeSettings } from "./settings";
import type { TemplateProps } from "./types";

/**
 * The wrapper every template renders inside: scoped CSS variables (never
 * global), the template's fonts, and — in the editor preview — an inert page
 * (links and buttons don't navigate or add to cart; category filters still work).
 */
export function TemplateRoot({
  code,
  settings,
  mode,
  children,
}: {
  code: string;
  settings: ThemeSettings;
  mode: TemplateProps["mode"];
  children: ReactNode;
}) {
  useEffect(() => {
    void loadFont(settings.font_heading);
    void loadFont(settings.font_body);
  }, [settings.font_heading, settings.font_body]);
  const style = themeCssVars(settings) as CSSProperties;
  return (
    <div
      className={`tpl tpl-${code}`}
      data-template={code}
      data-mode={mode}
      style={style}
      onClickCapture={
        mode === "preview"
          ? (e) => {
              const el = (e.target as HTMLElement).closest("a, [data-tpl-action]");
              if (el) {
                e.preventDefault();
                e.stopPropagation();
              }
            }
          : undefined
      }
    >
      {children}
    </div>
  );
}

export function AnnouncementBar({ settings }: { settings: ThemeSettings }) {
  const text = settings.announcement_text.trim();
  if (!settings.show_announcement || !text) return null;
  return (
    <div className="tpl-announcement" role="note">
      {text}
    </div>
  );
}

/**
 * Images on the page: https only. In the editor preview a not-yet-uploaded
 * file shows as a local blob: URL (created by the browser), so that is
 * allowed in preview mode only.
 */
export function safeImageUrl(url: string | null | undefined, mode: TemplateProps["mode"]) {
  if (mode === "preview" && url && url.startsWith("blob:")) return url;
  return safeHttpsUrl(url ?? null);
}

/** Hero image: the custom https image if set, else the store's banner. */
export function heroImage(
  store: Store,
  settings: ThemeSettings,
  mode: TemplateProps["mode"] = "live",
) {
  return safeHttpsUrl(settings.hero_image_url) ?? safeImageUrl(store.banner, mode);
}
export const heroTitle = (store: Store, s: ThemeSettings) => s.hero_title.trim() || store.name;
export const heroSubtitle = (s: ThemeSettings) => s.hero_subtitle.trim();
export const ctaLabel = (s: ThemeSettings) => s.hero_cta_label.trim();

export function CtaButton({
  settings,
  className,
}: {
  settings: ThemeSettings;
  className?: string;
}) {
  const label = ctaLabel(settings);
  if (!label) return null;
  return (
    <a href="#tpl-products" className={className ?? "tpl-button"}>
      {label}
    </a>
  );
}

export function StoreMark({
  store,
  className,
  mode = "live",
}: {
  store: Store;
  className?: string;
  mode?: TemplateProps["mode"];
}) {
  const logo = safeImageUrl(store.logo, mode);
  return logo ? (
    <img src={logo} alt="" className={className ?? "tpl-logo"} />
  ) : (
    <span className={`${className ?? "tpl-logo"} tpl-logo-fallback`} aria-hidden>
      {store.initials}
    </span>
  );
}

/** Product card built from the shared price/rating/stock logic. */
export function TemplateProductCard({
  product,
  variant = "default",
}: {
  product: Product;
  variant?: "default" | "compact" | "minimal" | "bold";
}) {
  const { t } = useTranslation("store");
  const format = useFormat();
  const { add } = useCart();
  const out = product.stock < 1;
  return (
    <article className="tpl-card" data-variant={variant}>
      <Link
        to="/product/$id"
        params={{ id: productParam(product) }}
        className="tpl-card-media"
        aria-label={product.title}
      >
        {product.image ? (
          <img src={product.image} alt="" loading="lazy" />
        ) : (
          <ImageOff aria-hidden />
        )}
        {product.badge && (
          <span className="tpl-badge">
            {t(`badge.${product.badge.toLowerCase()}`, {
              ns: "product",
              defaultValue: product.badge,
            })}
          </span>
        )}
      </Link>
      {/* A sibling of the link (never inside it), placed over the photo. */}
      <WishlistButton productId={product.id} title={product.title} className="tpl-heart" />
      <div className="tpl-card-body">
        <Link to="/product/$id" params={{ id: productParam(product) }} className="tpl-card-title">
          {product.title}
        </Link>
        {variant !== "minimal" && <Rating rating={product.rating} reviews={product.reviews} />}
        <div className="tpl-card-price">
          <span>{format.price(product.price)}</span>
          {product.originalPrice && <s>{format.price(product.originalPrice)}</s>}
        </div>
        {variant === "compact" && (
          <span className="tpl-card-stock" data-out={out || undefined}>
            {out
              ? t("template.outOfStock")
              : product.stock <= 5
                ? t("template.onlyLeft", { count: product.stock })
                : t("template.inStock")}
          </span>
        )}
        <button
          type="button"
          className="tpl-add"
          data-tpl-action
          disabled={out}
          onClick={() => add(product.id)}
          aria-label={t("template.addAria", { title: product.title })}
        >
          <Plus size={14} aria-hidden />
          <span>{out ? t("template.soldOut") : t("template.addToCart")}</span>
        </button>
      </div>
    </article>
  );
}

export function ProductGrid({
  products,
  variant,
  emptyName,
}: {
  products: Product[];
  variant?: "default" | "compact" | "minimal" | "bold";
  emptyName: string;
}) {
  const { t } = useTranslation("store");
  if (!products.length)
    return (
      <div className="tpl-empty">
        <StoreIcon aria-hidden />
        <p>{t("template.empty", { store: emptyName })}</p>
      </div>
    );
  return (
    <div className="tpl-grid">
      {products.map((p) => (
        <TemplateProductCard key={p.id} product={p} variant={variant ?? "default"} />
      ))}
    </div>
  );
}

/** In-page category filter (works the same on every host). */
export function useCategoryFilter(products: Product[]) {
  const [category, setCategory] = useState("");
  const shown = category ? products.filter((p) => p.category === category) : products;
  return { category, setCategory, shown };
}

export function CategoryChips({
  categories,
  value,
  onChange,
  variant = "chips",
}: {
  categories: Category[];
  value: string;
  onChange: (slug: string) => void;
  variant?: "chips" | "tabs" | "tiles" | "blocks";
}) {
  const { t } = useTranslation("store");
  const categoryName = useCategoryName();
  if (!categories.length) return null;
  return (
    <div
      className="tpl-cats"
      data-variant={variant}
      role="group"
      aria-label={t("template.shopByCategory")}
    >
      <button type="button" aria-pressed={!value} onClick={() => onChange("")}>
        {t("template.all")}
      </button>
      {categories.map((c) => (
        <button
          key={c.slug}
          type="button"
          aria-pressed={value === c.slug}
          onClick={() => onChange(c.slug)}
        >
          {variant === "tiles" && c.image && <img src={c.image} alt="" loading="lazy" />}
          <span>{categoryName(c.slug, c.name)}</span>
        </button>
      ))}
    </div>
  );
}

/** Featured = items on sale first, then the newest; only when there are more than four. */
export function featuredProducts(products: Product[], count = 4) {
  if (products.length <= count) return [];
  return [...products]
    .sort((a, b) => Number(!!b.originalPrice) - Number(!!a.originalPrice))
    .slice(0, count);
}

export function AboutSection({
  store,
  settings,
  title,
}: {
  store: Store;
  settings: ThemeSettings;
  title?: string;
}) {
  const { t } = useTranslation("store");
  const text = store.description.trim();
  if (!settings.show_about || !text) return null;
  return (
    <section className="tpl-about" aria-labelledby="tpl-about-title">
      <h2 id="tpl-about-title" className="tpl-h2">
        {title ?? t("template.about")}
      </h2>
      <p dir="auto">{text}</p>
    </section>
  );
}
