import { createFileRoute } from "@tanstack/react-router";
import { Browse } from "@/components/marketplace/browse";
import { catalogQuery } from "@/services/catalog";
import { CatalogSkeleton } from "@/components/marketplace/shared";
export const Route = createFileRoute("/products")({
  validateSearch: (s: Record<string, unknown>): { q?: string; sort?: string; sale?: boolean } => ({
    ...(typeof s["q"] === "string" ? { q: s["q"] } : {}),
    ...(typeof s["sort"] === "string" ? { sort: s["sort"] } : {}),
    ...(s["sale"] === true || s["sale"] === "true" ? { sale: true } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Discover Products — Saloree" },
      {
        name: "description",
        content:
          "Browse all Saloree products. Filter by category, price, rating, and independent store.",
      },
      { property: "og:title", content: "Discover Products — Saloree" },
      {
        property: "og:description",
        content: "Explore everyday favorites from all our independent stores.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(catalogQuery),
  pendingComponent: CatalogSkeleton,
  component: ProductsPage,
});
function ProductsPage() {
  const { q, sort, sale } = Route.useSearch();
  return (
    <Browse
      key={`${q}-${sort}-${sale}`}
      query={q ?? ""}
      initialSort={sort ?? "newest"}
      sale={sale ?? false}
    />
  );
}
