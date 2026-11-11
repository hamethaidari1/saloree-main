import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { catalogQuery } from "@/services/catalog";
import { StoreCard, CatalogSkeleton } from "@/components/marketplace/shared";
export const Route = createFileRoute("/stores")({
  head: () => ({
    meta: [
      { title: "Meet Our Independent Stores — Saloree" },
      {
        name: "description",
        content: "Meet the independent stores behind your favorite Saloree finds.",
      },
      { property: "og:title", content: "Meet Our Independent Stores — Saloree" },
      {
        property: "og:description",
        content:
          "Small stores with big personality. Discover the people behind your favorite finds.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(catalogQuery),
  pendingComponent: CatalogSkeleton,
  component: StoresPage,
});
function StoresPage() {
  const {
    data: { stores },
  } = useSuspenseQuery(catalogQuery);
  return (
    <main className="market-container pb-16">
      <div className="breadcrumb">
        <Link to="/">Home</Link>
        <ChevronRight />
        <span>Our stores</span>
      </div>
      <h1 className="page-title">Small stores. Big personality.</h1>
      <p className="page-subtitle mb-8">
        Meet the independent businesses behind your favorite finds.
      </p>
      <div className="store-grid">
        {stores.map((s) => (
          <StoreCard key={s.slug} store={s} />
        ))}
      </div>
    </main>
  );
}
