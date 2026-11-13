import { headT } from "@/i18n/head";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { storeFromMatches } from "@/lib/store-mode";
import { Browse } from "@/components/marketplace/browse";
import { catalogQuery } from "@/services/catalog";
import { CatalogSkeleton } from "@/components/marketplace/shared";
export const Route = createFileRoute("/category/$slug")({
  loader: async ({ params, context }) => {
    const { categories } = await context.queryClient.ensureQueryData(catalogQuery);
    const category = categories.find((c) => c.slug === params.slug);
    if (!category) throw notFound();
    return category;
  },
  head: ({ loaderData, matches }) => {
    const t = headT(matches, "product");
    const name = loaderData
      ? headT(matches, "categories")(loaderData.slug, { defaultValue: loaderData.name })
      : t("meta.categoryFallback");
    const title = t("titleWithSite", {
      ns: "common",
      title: name,
      site: storeFromMatches(matches)?.name ?? "Saloree",
    });
    return {
      meta: [
        { title },
        { name: "description", content: t("meta.categoryDescription", { category: name }) },
        { property: "og:title", content: title },
        { property: "og:description", content: t("meta.categoryOgDescription") },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
      ],
    };
  },
  pendingComponent: CatalogSkeleton,
  component: CategoryPage,
});
function CategoryPage() {
  const { slug } = Route.useParams();
  return <Browse key={slug} category={slug} />;
}
