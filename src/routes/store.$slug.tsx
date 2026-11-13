import { useTranslation } from "react-i18next";
import { headT } from "@/i18n/head";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { catalogService, catalogQuery } from "@/services/catalog";
import { useSuspenseQuery } from "@tanstack/react-query";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { StoreAddressLink } from "@/components/marketplace/store-link";
import { loadThemeForStorefront } from "@/services/themes";
import { templateDataFromCatalog } from "@/templates/data";
import { resolveTheme } from "@/templates/registry";
import { TemplateView } from "@/templates/render";

export const Route = createFileRoute("/store/$slug")({
  loader: async ({ params, context }) => {
    await context.queryClient.ensureQueryData(catalogQuery);
    const store = await catalogService.getStore(params.slug);
    if (!store) throw notFound();
    // Same saved template + settings as the store's own address.
    const theme = await loadThemeForStorefront(
      (q) => context.queryClient.ensureQueryData(q),
      store.id,
    );
    return { store, theme };
  },
  head: ({ loaderData, matches }) => {
    const t = headT(matches, "store");
    const store = loaderData?.store;
    const title = t("titleWithSite", {
      ns: "common",
      title: store?.name ?? t("page.fallbackName"),
      site: "Saloree",
    });
    return {
      meta: [
        { title },
        { name: "description", content: store?.description || t("page.description") },
        { property: "og:title", content: title },
        { property: "og:description", content: store?.description || t("page.ogDescription") },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  pendingComponent: CatalogSkeleton,
  component: StorePage,
});

function StorePage() {
  const { t } = useTranslation("store");
  const { store, theme } = Route.useLoaderData();
  const { data: catalog } = useSuspenseQuery(catalogQuery);
  const { template, settings } = resolveTheme(theme);
  return (
    <main>
      <div className="market-container">
        <div className="breadcrumb">
          <Link to="/">{t("home", { ns: "common" })}</Link>
          <ChevronRight className="rtl:-scale-x-100" />
          <Link to="/stores">{t("stores.crumb")}</Link>
          <ChevronRight className="rtl:-scale-x-100" />
          <span>{store.name}</span>
        </div>
        <p className="mb-3">
          <StoreAddressLink slug={store.slug} />
        </p>
      </div>
      <TemplateView
        template={template}
        settings={settings}
        data={templateDataFromCatalog(store, catalog)}
        mode="live"
      />
    </main>
  );
}
