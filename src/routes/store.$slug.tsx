import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { catalogService, catalogQuery } from "@/services/catalog";
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  ProductCard,
  Rating,
  SectionHeading,
  CatalogSkeleton,
} from "@/components/marketplace/shared";
export const Route = createFileRoute("/store/$slug")({
  loader: async ({ params, context }) => {
    await context.queryClient.ensureQueryData(catalogQuery);
    const store = await catalogService.getStore(params.slug);
    if (!store) throw notFound();
    return store;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.name ?? "Store"} — Saloree` },
      {
        name: "description",
        content: loaderData?.description ?? "Discover independent stores on Saloree.",
      },
      { property: "og:title", content: `${loaderData?.name ?? "Store"} — Saloree` },
      {
        property: "og:description",
        content: loaderData?.description ?? "Shop thoughtful finds from independent stores.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  pendingComponent: CatalogSkeleton,
  component: StorePage,
});
function StorePage() {
  const store = Route.useLoaderData();
  const {
    data: { products },
  } = useSuspenseQuery(catalogQuery);
  const items = products.filter((p) => p.storeSlug === store.slug);
  return (
    <main className="market-container">
      <div className="breadcrumb">
        <Link to="/">Home</Link>
        <ChevronRight />
        <Link to="/stores">Our stores</Link>
        <ChevronRight />
        <span>{store.name}</span>
      </div>
      <div className={`store-banner tone-${store.tone}`}>
        <img src={store.image} alt={`${store.name} collection`} width="1280" height="245" />
      </div>
      <section className="store-page-identity">
        <span className="store-avatar">{store.initials}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="page-title">{store.name}</h1>
            <ShieldCheck size={20} className="text-primary" />
          </div>
          <Rating rating={store.rating} />
          <p>{store.description}</p>
        </div>
      </section>
      <section className="market-section all-products">
        <SectionHeading
          title={`From ${store.name}`}
          subtitle={`${items.length} thoughtfully selected finds`}
        />
        <div className="product-grid">
          {items.map((p) => (
            <ProductCard product={p} key={p.id} />
          ))}
        </div>
      </section>
    </main>
  );
}
