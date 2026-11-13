import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  notFound,
  redirect,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { CartProvider } from "@/components/marketplace/cart-context";
import { AuthProvider } from "@/lib/auth";
import { LOGO } from "@/lib/brand";
import { DEV_STORE_PARAM, isMainOnlyPath, mainSiteUrl, resolveDevStore } from "@/lib/host";
import { hidesSiteChrome } from "@/lib/layout";
import { persistDevStore, resolveStoreSlug } from "@/lib/store-mode";
import { CountryProvider } from "@/lib/country";
import { Navbar, Footer } from "@/components/marketplace/shared";
import { StoreFooter, StoreHeader, StoreNotFound } from "@/components/marketplace/storefront";
import { Toaster } from "@/components/ui/sonner";
import type { Store } from "@/data/catalog";
import { catalogQuery } from "@/services/catalog";
import { loadThemeForStorefront, type StoreThemeRecord } from "@/services/themes";
import { useTranslation } from "react-i18next";
import { DEFAULT_LOCALE, dirFor } from "@/i18n/locales";
import { isEnglishOnlyPath } from "@/i18n/resolve";
import { readRequestLocale } from "@/i18n/request";
import { loadLocaleResources, type LocaleResources } from "@/i18n/load";
import { headT, type I18nContext } from "@/i18n/head";
import { I18nProvider } from "@/i18n/react";
import enCommon from "@/locales/en/common.json";

/** English common strings for the error page if the language never loaded. */
const ENGLISH_FALLBACK = { common: enCommon } as unknown as LocaleResources;

/**
 * The root's not-found / error pages render outside RootComponent, so they get
 * their own translations from the root context (English if it never loaded).
 */
function WithI18n({ children }: { children: ReactNode }) {
  const i18n = useRouterState({
    select: (s) =>
      (s.matches.find((m) => m.routeId === "__root__")?.context as { i18n?: I18nContext })?.i18n ??
      null,
  });
  return (
    <I18nProvider
      locale={i18n?.locale ?? DEFAULT_LOCALE}
      resources={i18n?.resources ?? ENGLISH_FALLBACK}
    >
      {children}
    </I18nProvider>
  );
}

function NotFoundComponent() {
  return (
    <WithI18n>
      <NotFoundBody />
    </WithI18n>
  );
}
function NotFoundBody() {
  const { storeSlug } = Route.useRouteContext();
  const { t } = useTranslation();
  if (storeSlug) return <StoreNotFound />;
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">{t("notFound.title")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("notFound.text")}</p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("goHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent(props: ErrorComponentProps) {
  return (
    <WithI18n>
      <ErrorBody {...props} />
    </WithI18n>
  );
}
function ErrorBody({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  const { t } = useTranslation();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("error.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("error.text")}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t("tryAgain")}
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {t("goHome")}
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  /**
   * Store mode: `<slug>.<VITE_ROOT_DOMAIN>` (or `?store=<slug>` in dev) turns
   * the site into that store's storefront. Account, checkout and dashboards
   * only exist on the main domain, so those paths are sent there.
   */
  beforeLoad: async ({ location }) => {
    const storeSlug = resolveStoreSlug(location.search as Record<string, unknown>);
    if (storeSlug && isMainOnlyPath(location.pathname)) {
      const params = new URLSearchParams(location.searchStr);
      params.delete(DEV_STORE_PARAM);
      const query = params.toString();
      throw redirect({
        href: mainSiteUrl(`${location.pathname}${query ? `?${query}` : ""}`),
        statusCode: 302,
      });
    }
    // Language: `lang` cookie → Accept-Language → en, known on the server so the
    // first HTML is already in the right language. Only that language is loaded.
    const locale = isEnglishOnlyPath(location.pathname) ? DEFAULT_LOCALE : readRequestLocale();
    const resources = await loadLocaleResources(locale);
    const i18n: I18nContext = { locale, resources };
    return { storeSlug, i18n };
  },
  loader: async ({ context }): Promise<{ store: Store | null; theme: StoreThemeRecord | null }> => {
    if (!context.storeSlug) return { store: null, theme: null };
    // The catalog only holds published stores, so drafts are "not found" too.
    const catalog = await context.queryClient.ensureQueryData(catalogQuery);
    const store = catalog.stores.find((s) => s.slug === context.storeSlug);
    if (!store) throw notFound();
    // Loaded on the server too, so the store renders in its theme with no flash.
    const theme = await loadThemeForStorefront(
      (q) => context.queryClient.ensureQueryData(q),
      store.id,
    );
    return { store, theme };
  },
  head: ({ loaderData, match }) => {
    const t = headT([{ routeId: "__root__", context: match.context }]);
    const store = loaderData?.store ?? null;
    const missingStore = !!match.context.storeSlug && !store;
    const title = store
      ? store.name
      : missingStore
        ? t("meta.storeNotFound")
        : t("meta.defaultTitle");
    const description = store
      ? store.description || t("meta.storeDescription", { store: store.name })
      : t("meta.defaultDescription");
    const icon = store?.logo ?? LOGO.src;
    return {
      // Each content route, / included, must still set its own head(). Never add og:image or
      // twitter:image here: every page without its own would inherit the root's preview image.
      meta: [
        { charSet: "utf-8" },
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { title },
        { name: "description", content: description },
        { name: "author", content: store?.name ?? "Saloree" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        ...(missingStore ? [{ name: "robots", content: "noindex" }] : []),
      ],
      links: [
        {
          rel: "stylesheet",
          href: appCss,
        },
        // Store logo when it has one, Saloree's otherwise.
        { rel: "icon", href: icon, ...(store?.logo ? {} : { type: LOGO.type }) },
        { rel: "apple-touch-icon", href: icon },
        { rel: "preconnect", href: "https://fonts.googleapis.com" },
        { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Manrope:wght@400;500;600;650;700;800&display=swap",
        },
      ],
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  const locale = useRouterState({
    select: (s) =>
      (s.matches.find((m) => m.routeId === "__root__")?.context as { i18n?: I18nContext })?.i18n
        ?.locale ?? DEFAULT_LOCALE,
  });
  return (
    <html lang={locale} dir={dirFor(locale)}>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient, storeSlug, i18n } = Route.useRouteContext();
  // Undefined when the root loader threw notFound (unknown / draft store).
  const store = Route.useLoaderData()?.store ?? null;
  // A store site whose store doesn't exist shows only the "Store not found" page.
  const chrome = !storeSlug && !store;
  // The seller dashboard has its own sidebar, so the store navbar/footer are hidden there.
  const appShell = useRouterState({ select: (s) => hidesSiteChrome(s.location.pathname) });

  // Dev store override: the first page may be server-rendered from `?store=`;
  // remember it in this tab so later navigations stay in store mode.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const param = new URLSearchParams(window.location.search).get(DEV_STORE_PARAM);
    if (param === null) return;
    const dev = resolveDevStore({ param, session: null, cookie: null });
    persistDevStore(dev.persist, dev.slug);
  }, []);

  return (
    <I18nProvider locale={i18n.locale} resources={i18n.resources}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <CountryProvider>
            <CartProvider>
              {store ? <StoreHeader store={store} /> : chrome && !appShell && <Navbar />}
              <Outlet />
              {store ? <StoreFooter store={store} /> : chrome && !appShell && <Footer />}
              {/* Toasts sit at the inline end and read in the page's direction. */}
              <Toaster
                dir={dirFor(i18n.locale)}
                position={dirFor(i18n.locale) === "rtl" ? "bottom-left" : "bottom-right"}
              />
            </CartProvider>
          </CountryProvider>
        </AuthProvider>
      </QueryClientProvider>
    </I18nProvider>
  );
}
