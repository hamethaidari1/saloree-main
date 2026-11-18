import { headT } from "@/i18n/head";
import { createFileRoute } from "@tanstack/react-router";
import { storeFromMatches } from "@/lib/store-mode";
import { Browse } from "@/components/marketplace/browse";
import { catalogQuery } from "@/services/catalog";
import { CatalogSkeleton } from "@/components/marketplace/shared";
export const Route = createFileRoute("/products")({
  validateSearch: (
    s: Record<string, unknown>,
  ): { q?: string; category?: string; sort?: string; sale?: boolean; brand?: string } => ({
    ...(typeof s["q"] === "string" ? { q: s["q"] } : {}),
    ...(typeof s["brand"] === "string" && s["brand"].trim() && s["brand"].length <= 80
      ? { brand: s["brand"] }
      : {}),
    ...(typeof s["category"] === "string" && s["category"] ? { category: s["category"] } : {}),
    ...(typeof s["sort"] === "string" ? { sort: s["sort"] } : {}),
    ...(s["sale"] === true || s["sale"] === "true" ? { sale: true } : {}),
  }),
  head: ({ matches }) => {
    const t = headT(matches, "product");
    const store = storeFromMatches(matches);
    const title = t("titleWithSite", {
      ns: "common",
      title: store ? t("meta.storeProductsTitle") : t("meta.productsTitle"),
      site: store?.name ?? "Saloree",
    });
    return {
      meta: [
        { title },
        { name: "description", content: t("meta.productsDescription") },
        { property: "og:title", content: title },
        { property: "og:description", content: t("meta.productsOgDescription") },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(catalogQuery),
  pendingComponent: CatalogSkeleton,
  component: ProductsPage,
});
function ProductsPage() {
  const { q, category, sort, sale, brand } = Route.useSearch();
  return (
    <Browse
      key={`${q}-${category}-${sort}-${sale}-${brand}`}
      brand={brand ?? ""}
      query={q ?? ""}
      category={category ?? ""}
      initialSort={sort ?? "newest"}
      sale={sale ?? false}
    />
  );
}
