import { createFileRoute, notFound } from "@tanstack/react-router";
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
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.name ?? "Category"} — Saloree` },
      {
        name: "description",
        content: `Discover ${loaderData?.name ?? "thoughtful products"} from independent stores on Saloree.`,
      },
      { property: "og:title", content: `${loaderData?.name ?? "Category"} — Saloree` },
      {
        property: "og:description",
        content: "Find your next everyday favorite from an independent store.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  pendingComponent: CatalogSkeleton,
  component: CategoryPage,
});
function CategoryPage() {
  const { slug } = Route.useParams();
  return <Browse key={slug} category={slug} />;
}
