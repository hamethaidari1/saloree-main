import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { catalogQuery } from "@/services/catalog";
import {
  ProductCard,
  StoreCard,
  SectionHeading,
  TrustStrip,
  CatalogSkeleton,
} from "@/components/marketplace/shared";
import hero from "@/assets/saloree-home.jpg";
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Saloree — Independent stores. Extraordinary finds." },
      {
        name: "description",
        content:
          "Discover thoughtful products from independent stores on Saloree. Shop home, fashion, technology, and everyday essentials in one shared cart.",
      },
      { property: "og:title", content: "Saloree — A world of thoughtful finds" },
      {
        property: "og:description",
        content:
          "Independent stores, extraordinary finds. Discover something special for every day.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(catalogQuery),
  pendingComponent: CatalogSkeleton,
  component: Home,
});
function Home() {
  const {
    data: { products, categories, stores },
  } = useSuspenseQuery(catalogQuery);
  const [category, setCategory] = useState("");
  return (
    <main className="market-container">
      <section className="home-hero">
        <img
          src={hero}
          className="hero-image"
          alt="Thoughtfully styled home with a cozy lounge chair, ceramic vase, and natural textures"
          width="1920"
          height="1024"
          fetchPriority="high"
        />
        <div className="hero-content">
          <span className="eyebrow">
            <Sparkles size={12} />A WORLD OF THOUGHTFUL FINDS
          </span>
          <h1>
            Small stores.
            <br />
            <span>Wonderful discoveries.</span>
          </h1>
          <p>
            Meet your next favorite thing. Discover beautifully chosen products from independent
            stores, all in one place.
          </p>
          <Button asChild size="lg">
            <Link to="/products">
              Explore the collection
              <ArrowRight size={15} />
            </Link>
          </Button>
        </div>
        <div className="hero-index" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>
      <TrustStrip />
      <section className="market-section">
        <SectionHeading
          title="Find your kind of thing"
          subtitle="A little inspiration for every corner of your life."
        />
        <div className="categories-grid">
          {categories.map((c) => (
            <Link
              to="/category/$slug"
              params={{ slug: c.slug }}
              key={c.slug}
              className="category-tile"
            >
              <div className="category-photo">
                <img src={c.image} alt={c.name} loading="lazy" width="384" height="512" />
              </div>
              <span>{c.name}</span>
            </Link>
          ))}
        </div>
      </section>
      <section className="market-section">
        <SectionHeading
          title="Worth a closer look"
          subtitle="Our featured finds. Your soon-to-be favorites."
        />
        <div className="product-grid">
          {products.slice(0, 4).map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>
      <section className="editorial-band">
        <div className="editorial-copy">
          <span className="eyebrow">THE EVERYDAY EDIT</span>
          <h2>Good things. Everyday living.</h2>
          <p>Natural textures, thoughtful details, and little things that make a big difference.</p>
          <Button asChild variant="outline">
            <Link to="/category/$slug" params={{ slug: "home-kitchen" }}>
              Make yourself at home
              <ArrowRight />
            </Link>
          </Button>
        </div>
        <div className="editorial-image">
          <img
            src={products[4]?.image}
            alt={products[4]?.title ?? ""}
            width="384"
            height="512"
            loading="lazy"
          />
          <img
            src={products[7]?.image}
            alt={products[7]?.title ?? ""}
            width="384"
            height="512"
            loading="lazy"
          />
        </div>
      </section>
      <section className="market-section">
        <SectionHeading
          title="Fresh on the shelves"
          subtitle="New arrivals with a little extra something."
        >
          <Link to="/products" search={{ sort: "newest" }}>
            Shop new arrivals
            <ArrowRight size={13} />
          </Link>
        </SectionHeading>
        <div className="product-grid">
          {products.slice(8, 12).map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>
      <section className="market-section">
        <SectionHeading
          title="Small stores. Big personality."
          subtitle="Get to know the people behind your favorite finds."
          to="/stores"
        />
        <div className="store-grid">
          {stores.map((s) => (
            <StoreCard key={s.slug} store={s} />
          ))}
        </div>
      </section>
      <section className="market-section all-products">
        <SectionHeading
          title="Discover something you love"
          subtitle="All our stores. One lovely place to explore."
        />
        <div className="category-tabs">
          <Button
            size="sm"
            variant={!category ? "default" : "ghost"}
            onClick={() => setCategory("")}
          >
            All finds
          </Button>
          {categories.map((c) => (
            <Button
              key={c.slug}
              size="sm"
              variant={category === c.slug ? "default" : "ghost"}
              onClick={() => setCategory(c.slug)}
            >
              {c.name}
            </Button>
          ))}
        </div>
        <div className="product-grid">
          {products
            .filter((p) => !category || p.category === category)
            .slice(0, 8)
            .map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
        </div>
        <div className="text-center mt-8">
          <Button asChild variant="outline">
            <Link to="/products">
              Discover more finds
              <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
