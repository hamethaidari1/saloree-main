import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronRight, ArrowRight, Truck, ShieldCheck, Heart, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSuspenseQuery } from "@tanstack/react-query";
import { catalogQuery, catalogService, money } from "@/services/catalog";
import { useCart } from "@/components/marketplace/cart-context";
import {
  Rating,
  QuantityPicker,
  ProductCard,
  SectionHeading,
  CatalogSkeleton,
} from "@/components/marketplace/shared";
export const Route = createFileRoute("/product/$id")({
  loader: async ({ params, context }) => {
    const [product] = await Promise.all([
      catalogService.getProduct(params.id),
      context.queryClient.ensureQueryData(catalogQuery),
    ]);
    if (!product) throw notFound();
    return product;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.title ?? "Product"} — Saloree` },
      {
        name: "description",
        content: loaderData?.description ?? "Discover thoughtful products on Saloree.",
      },
      { property: "og:title", content: `${loaderData?.title ?? "Product"} — Saloree` },
      {
        property: "og:description",
        content: loaderData?.description ?? "Everyday favorites from independent stores.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  pendingComponent: CatalogSkeleton,
  component: ProductPage,
});
function ProductPage() {
  const p = Route.useLoaderData();
  return <ProductDetail key={p.id} product={p} />;
}
function ProductDetail({ product: p }: { product: import("@/data/catalog").Product }) {
  const {
    data: { stores, products },
  } = useSuspenseQuery(catalogQuery);
  const store = stores.find((s) => s.slug === p.storeSlug);
  const [quantity, setQuantity] = useState(1);
  const [view, setView] = useState("full");
  const { add } = useCart();
  const related = products
    .filter((item) => item.category === p.category && item.id !== p.id)
    .slice(0, 4);
  return (
    <main className="market-container">
      <div className="breadcrumb">
        <Link to="/">Home</Link>
        <ChevronRight />
        <Link to="/products">All products</Link>
        <ChevronRight />
        <span>{p.title}</span>
      </div>
      <section className="product-detail">
        <div>
          <div className="detail-photo">
            <img
              src={p.image}
              alt={`${p.title}${view === "detail" ? " detail" : ""}`}
              width="384"
              height="512"
              className={view === "detail" ? "scale-125" : ""}
              fetchPriority="high"
            />
          </div>
          <div className="detail-thumbnails">
            {["full", "detail"].map((v) => (
              <Button
                key={v}
                variant="outline"
                aria-label={v === "full" ? "Full product view" : "Product detail view"}
                aria-pressed={view === v}
                onClick={() => setView(v)}
                className={view === v ? "border-primary" : ""}
              >
                <img
                  src={p.image}
                  alt={v === "full" ? "Full view" : "Detail"}
                  className={v === "detail" ? "scale-150" : ""}
                  width="72"
                  height="72"
                />
              </Button>
            ))}
          </div>
        </div>
        <div className="detail-copy">
          <Link to="/store/$slug" params={{ slug: p.storeSlug }} className="text-xs text-primary">
            {store?.name}
          </Link>
          <h1>{p.title}</h1>
          <Rating rating={p.rating} reviews={p.reviews} />
          <div className="detail-price">
            {money(p.price)}
            {p.originalPrice && <span className="old-price">{money(p.originalPrice)}</span>}
          </div>
          <p className="detail-description">{p.description}</p>
          <span className="stock-indicator">
            {p.stock > 0 ? `In stock · ${p.stock} available` : "Out of stock"}
          </span>
          <div className="purchase-row">
            <QuantityPicker value={quantity} max={p.stock} onChange={setQuantity} />
            <Button
              className="add-button"
              disabled={p.stock < 1}
              onClick={() => add(p.id, quantity)}
            >
              <PlusBag />
              Add to cart
              <ArrowRight />
            </Button>
          </div>
          <div className="detail-perks">
            <span>
              <Truck />
              Carefully packed
            </span>
            <span>
              <ShieldCheck />
              Quality, thoughtfully selected
            </span>
          </div>
          <div className="seller-box">
            <span className="store-avatar">{store?.initials}</span>
            <div className="flex-1">
              <p>Sold by an independent store</p>
              <Link to="/store/$slug" params={{ slug: p.storeSlug }}>
                {store?.name}
              </Link>
              <Rating rating={store?.rating ?? 0} />
            </div>
            <Button asChild variant="outline" size="sm">
              <Link to="/store/$slug" params={{ slug: p.storeSlug }}>
                Visit store
                <ArrowRight />
              </Link>
            </Button>
          </div>
        </div>
      </section>
      {/* Hidden until a reviews table exists; the sample reviews would otherwise appear on real products. */}
      <section className="reviews-section" hidden={!(p.reviews > 0)}>
        <h2 className="text-xl font-semibold">A little love from our customers</h2>
        <div className="reviews-layout">
          <div>
            <strong className="text-4xl font-semibold">{p.rating.toFixed(1)}</strong>
            <Rating rating={p.rating} reviews={p.reviews} />
            <p className="text-xs text-muted-foreground mt-3">Customer reviews</p>
          </div>
          <div>
            {[
              {
                name: "Emma R.",
                text: "Such a lovely find. The quality feels great, and it looks just as beautiful in person.",
              },
              {
                name: "Daniel M.",
                text: "Thoughtfully made and carefully packed. A wonderful addition to my everyday routine.",
              },
            ].map((r) => (
              <div key={r.name} className="review-entry">
                <strong>{r.name}</strong>
                <small>Sample review</small>
                <Rating rating={5} />
                <p>{r.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="market-section all-products">
        <SectionHeading title="You might love these, too" />
        <div className="product-grid">
          {related.map((item) => (
            <ProductCard key={item.id} product={item} />
          ))}
        </div>
      </section>
    </main>
  );
}
function PlusBag() {
  return <Heart size={16} />;
}
