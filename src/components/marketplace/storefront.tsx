import { Trans, useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { ShieldCheck, Store as StoreIcon, UserRound } from "lucide-react";
import type { Category, Product, Store } from "@/data/catalog";
import { useAuth } from "@/lib/auth";
import { mainSiteUrl } from "@/lib/host";
import type { StoreThemeRecord } from "@/services/themes";
import { templateDataFromCatalog } from "@/templates/data";
import { resolveTheme } from "@/templates/registry";
import { TemplateView } from "@/templates/render";
import { CartLink } from "./header/site-header";
import { SearchBar } from "./header/search-bar";
import { Rating } from "./shared";

export function StoreAvatar({ store }: { store: Store }) {
  return store.logo ? (
    <img src={store.logo} alt="" className="store-avatar store-avatar-img" />
  ) : (
    <span className="store-avatar" aria-hidden>
      {store.initials}
    </span>
  );
}

/** Banner + logo, name, description. Used by /store/<slug> and the store site. */
export function StoreHero({ store, headingLevel = 1 }: { store: Store; headingLevel?: 1 | 2 }) {
  const { t } = useTranslation("store");
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <>
      <div className={`store-banner tone-${store.tone}`}>
        <img src={store.banner ?? store.image} alt="" width="1280" height="245" />
      </div>
      <section className="store-page-identity">
        <StoreAvatar store={store} />
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Heading className="page-title">{store.name}</Heading>
            <ShieldCheck size={20} className="text-primary" aria-label={t("verified")} />
          </div>
          <Rating rating={store.rating} />
          {store.description && <p>{store.description}</p>}
        </div>
      </section>
    </>
  );
}

/**
 * A store's storefront in its saved template + settings (Classic defaults
 * when it has none). Rendered by the same TemplateView as the editor preview.
 */
export function StoreHome({
  store,
  products,
  categories,
  theme,
}: {
  store: Store;
  products: Product[];
  categories: Category[];
  theme: StoreThemeRecord | null;
}) {
  const { template, settings } = resolveTheme(theme);
  return (
    <main>
      <TemplateView
        template={template}
        settings={settings}
        data={templateDataFromCatalog(store, { products, categories })}
        mode="live"
      />
    </main>
  );
}

/** Header on a store's own site: its identity, search, account, cart. */
export function StoreHeader({ store }: { store: Store }) {
  const { t } = useTranslation("store");
  const { user, ready } = useAuth();
  return (
    <header className="store-header">
      <div className="market-container flex min-h-16 items-center gap-3 py-2">
        <Link
          to="/"
          className="store-header-brand"
          aria-label={t("homeLink", { store: store.name })}
        >
          <StoreAvatar store={store} />
          <span className="truncate">{store.name}</span>
        </Link>
        <div className="store-search hidden min-w-0 flex-1 md:block">
          <SearchBar compact />
        </div>
        <a
          href={mainSiteUrl(user ? "/account" : "/login")}
          className="store-header-action ms-auto md:ms-0"
        >
          <UserRound size={22} aria-hidden />
          <span className="hidden sm:inline">{ready && user ? t("account") : t("signIn")}</span>
        </a>
        <div className="store-cart">
          <CartLink />
        </div>
      </div>
      <div className="store-search market-container pb-3 md:hidden">
        <SearchBar compact />
      </div>
    </header>
  );
}

export function StoreFooter({ store }: { store: Store }) {
  const { t } = useTranslation("store");
  return (
    <footer className="store-footer">
      <div className="market-container flex flex-wrap items-center justify-between gap-3 py-6 text-sm">
        <span>{t("copyright", { year: new Date().getFullYear(), store: store.name })}</span>
        <span className="flex flex-wrap gap-4">
          <a href={mainSiteUrl("/help")}>{t("help")}</a>
          <a href={mainSiteUrl("/")}>
            <Trans t={t} i18nKey="poweredBy" components={{ 1: <strong /> }} />
          </a>
        </span>
      </div>
    </footer>
  );
}

/**
 * Unknown, draft or unpublished store. Rendered from the root not-found
 * boundary, so it uses no app providers.
 */
export function StoreNotFound() {
  const { t } = useTranslation("store");
  return (
    <main className="store-not-found" role="main">
      <StoreIcon size={40} aria-hidden />
      <h1>{t("notFound.title")}</h1>
      <p>{t("notFound.text")}</p>
      <a href={mainSiteUrl("/")} className="store-not-found-link">
        {t("notFound.link")}
      </a>
    </main>
  );
}
