import { useTranslation } from "react-i18next";
import { headT } from "@/i18n/head";
import { listingExtras } from "@/lib/seo-pages";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { catalogQuery } from "@/services/catalog";
import { StoreCard, CatalogSkeleton } from "@/components/marketplace/shared";
export const Route = createFileRoute("/stores")({
  head: ({ matches }) => {
    const t = headT(matches, "store");
    return {
      meta: [
        { title: t("stores.metaTitle") },
        { name: "description", content: t("stores.metaDescription") },
        { property: "og:title", content: t("stores.metaTitle") },
        { property: "og:description", content: t("stores.ogDescription") },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        ...listingExtras("/stores", false).meta,
      ],
      links: listingExtras("/stores", false).links,
    };
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(catalogQuery),
  pendingComponent: CatalogSkeleton,
  component: StoresPage,
});
function StoresPage() {
  const { t } = useTranslation("store");
  const {
    data: { stores },
  } = useSuspenseQuery(catalogQuery);
  return (
    <main className="market-container pb-16">
      <div className="breadcrumb">
        <Link to="/">{t("home", { ns: "common" })}</Link>
        <ChevronRight className="rtl:-scale-x-100" />
        <span>{t("stores.crumb")}</span>
      </div>
      <h1 className="page-title">{t("stores.title")}</h1>
      <p className="page-subtitle mb-8">{t("stores.subtitle")}</p>
      <div className="store-grid">
        {stores.map((s) => (
          <StoreCard key={s.slug} store={s} />
        ))}
      </div>
    </main>
  );
}
