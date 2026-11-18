import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { Link } from "@tanstack/react-router";
import { createSupabaseMock } from "./supabase-mock";
import { renderWithRouter, testQueryClient } from "./router-harness";
import { WithLocale } from "./i18n";

vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  return { supabase: create().supabase };
});
void createSupabaseMock;

import type { Catalog, Category, Product } from "@/data/catalog";
import type { Locale } from "@/i18n/locales";
import { catalogQuery } from "@/services/catalog";
import { CartProvider } from "@/components/marketplace/cart-context";
import { HomeEmpty, MoreForYou, Shelf } from "@/components/marketplace/home-shelves";
import {
  allForYou,
  categoryShelves,
  inStockFirst,
  MORE_PAGE,
  moreShown,
  newArrivals,
  popular,
  SHELF_SIZE,
} from "@/lib/home-sections";

const DAY = 86_400_000;
const product = (i: number, patch: Partial<Product> = {}): Product => ({
  id: `p${i}`,
  title: `Product ${i}`,
  price: 10 + i,
  rating: 0,
  reviews: 0,
  storeSlug: "nordic",
  category: ["home-kitchen", "fashion", "beauty", "tech"][i % 4] ?? "home-kitchen",
  image: `https://img.example/${i}.jpg`,
  images: [`https://img.example/${i}.jpg`],
  stock: 5,
  description: "",
  createdAt: Date.UTC(2026, 0, 1) + i * DAY,
  ...patch,
});
const many = (n: number) => Array.from({ length: n }, (_, i) => product(i));
const CATEGORIES: Category[] = [
  { slug: "beauty", name: "Beauty", image: "" },
  { slug: "fashion", name: "Fashion", image: "" },
  { slug: "home-kitchen", name: "Home & Kitchen", image: "" },
  { slug: "tech", name: "Tech", image: "" },
  { slug: "toys", name: "Toys", image: "" },
];

// ---------------------------------------------------------------------------
// Which products each shelf gets
// ---------------------------------------------------------------------------
describe("home shelves: selection", () => {
  it("in stock first, otherwise unchanged order", () => {
    const list = [product(1, { stock: 0 }), product(2), product(3, { stock: 0 }), product(4)];
    expect(inStockFirst(list).map((p) => p.id)).toEqual(["p2", "p4", "p1", "p3"]);
  });

  it("New arrivals: the 12 newest, in stock first", () => {
    const list = many(30);
    list[29] = product(29, { stock: 0 }); // the newest, but sold out
    const fresh = newArrivals(list);
    expect(fresh).toHaveLength(SHELF_SIZE);
    expect(fresh[0]!.id).toBe("p28");
    expect(fresh.map((p) => p.id)).not.toContain("p29");
    // Sold-out products still appear when there aren't enough in stock.
    expect(newArrivals([product(1, { stock: 0 })]).map((p) => p.id)).toEqual(["p1"]);
  });

  it("Popular is empty (hidden) without real popularity data", () => {
    expect(popular(many(20))).toEqual([]);
    const rated = [product(1, { reviews: 3 }), product(2, { reviews: 9 }), product(3)];
    expect(popular(rated).map((p) => p.id)).toEqual(["p2", "p1"]);
  });

  it("category shelves: the categories with the most products, never an empty one", () => {
    const list = [
      ...many(12), // 3 each in home-kitchen, fashion, beauty, tech
      product(100, { category: "beauty" }),
      product(101, { category: "beauty" }),
      product(102, { category: "fashion" }),
      product(103, { category: "unknown-category" }),
    ];
    const shelves = categoryShelves(list, CATEGORIES);
    expect(shelves.map((s) => s.category.slug)).toEqual([
      "beauty",
      "fashion",
      "home-kitchen",
      "tech",
    ]);
    expect(shelves[0]!.total).toBe(5);
    expect(shelves.every((s) => s.products.every((p) => p.category === s.category.slug))).toBe(
      true,
    );
    expect(shelves.map((s) => s.category.slug)).not.toContain("toys");
    expect(categoryShelves(list, CATEGORIES, 2)).toHaveLength(2);
    expect(categoryShelves(many(80), CATEGORIES).every((s) => s.products.length <= 12)).toBe(true);
    expect(categoryShelves([], CATEGORIES)).toEqual([]);
  });

  it("category shelves put products already shown above last (no repeated row)", () => {
    const list = many(40).map((p) => ({ ...p, category: "tech" }));
    const fresh = newArrivals(list);
    const [shelf] = categoryShelves(list, CATEGORIES, 6, 12, new Set(fresh.map((p) => p.id)));
    expect(shelf!.products).toHaveLength(12);
    expect(shelf!.products.some((p) => fresh.includes(p))).toBe(false);
    // Few products: the shelf is still full, the already-seen ones at the end.
    const few = many(14).map((p) => ({ ...p, category: "tech" }));
    const seen = new Set(newArrivals(few).map((p) => p.id));
    const [small] = categoryShelves(few, CATEGORIES, 6, 12, seen);
    expect(small!.products).toHaveLength(12);
    expect(seen.has(small!.products[0]!.id)).toBe(false);
  });

  it("counts what a category shelf adds; More for you puts unseen products first", () => {
    const list = many(12).map((p) => ({ ...p, category: "tech" }));
    const seen = new Set(newArrivals(list).map((p) => p.id));
    // A small marketplace: New arrivals already shows everything.
    expect(categoryShelves(list, CATEGORIES, 6, 12, seen)[0]!.unseen).toBe(0);
    const big = many(40);
    const seenBig = new Set(newArrivals(big).map((p) => p.id));
    const more = allForYou(big, seenBig);
    expect(more).toHaveLength(40);
    expect(more.slice(0, 28).some((p) => seenBig.has(p.id))).toBe(false);
  });

  it("More for you: everything, 24 at a time", () => {
    expect(allForYou(many(5))).toHaveLength(5);
    expect(moreShown(0, 100)).toBe(MORE_PAGE);
    expect(moreShown(1, 100)).toBe(48);
    expect(moreShown(5, 100)).toBe(100);
    expect(moreShown(0, 10)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function show(ui: React.ReactNode, products: Product[], locale: Locale = "en") {
  const client = testQueryClient();
  const catalog: Catalog = {
    products,
    categories: CATEGORIES,
    stores: [
      {
        id: "s1",
        slug: "nordic",
        name: "Nordic Goods",
        initials: "ng",
        description: "",
        rating: 0,
        specialty: "",
        image: "",
        logo: null,
        banner: null,
        ownerId: null,
        tone: "sage",
      },
    ],
  };
  client.setQueryData(catalogQuery.queryKey, catalog);
  return renderWithRouter(
    <WithLocale locale={locale}>
      <CartProvider>{ui}</CartProvider>
    </WithLocale>,
    "/",
    client,
  );
}

const viewAll = (children: React.ReactNode, label: string) => (
  <Link to="/products" search={{ sort: "newest" }} aria-label={label}>
    {children}
  </Link>
);

describe("home shelves: rendering", () => {
  it("a shelf: title, View all, 12 cards; only the first row loads eagerly", async () => {
    const list = newArrivals(many(30));
    show(<Shelf id="new" title="New arrivals" products={list} link={viewAll} eager />, list);
    const shelf = await screen.findByTestId("shelf-new");
    expect(within(shelf).getByRole("heading", { name: "New arrivals" })).toBeInTheDocument();
    const link = within(shelf).getByRole("link", { name: "View all: New arrivals" });
    expect(link.getAttribute("href")).toContain("/products?sort=newest");
    const cards = within(shelf).getAllByRole("article");
    expect(cards).toHaveLength(12);
    const imgs = within(shelf)
      .getAllByRole("img")
      .filter((i) => i.closest(".product-photo"));
    expect(imgs.slice(0, 5).every((i) => i.getAttribute("loading") === "eager")).toBe(true);
    expect(imgs.slice(5).every((i) => i.getAttribute("loading") === "lazy")).toBe(true);
    for (const img of imgs) {
      expect(img).toHaveAttribute("width");
      expect(img).toHaveAttribute("height");
    }
    expect(within(shelf).getAllByText("Nordic Goods")).toHaveLength(12); // the store name on every card
  });

  it("an empty shelf is not rendered at all", async () => {
    show(
      <>
        <Shelf id="popular" title="Popular" products={[]} link={viewAll} />
        <p>after</p>
      </>,
      [],
    );
    await screen.findByText("after");
    expect(screen.queryByTestId("shelf-popular")).toBeNull();
  });

  it("More for you: 24 first, 24 more per click, then a link to all products", async () => {
    const list = allForYou(many(50));
    show(<MoreForYou products={list} />, list);
    const more = await screen.findByTestId("shelf-more");
    const cards = () => within(more).getAllByRole("article");
    expect(cards()).toHaveLength(24);
    expect(within(more).getByRole("status")).toHaveTextContent("Showing 24 of 50 products");
    fireEvent.click(within(more).getByRole("button", { name: "Load 24 more" }));
    expect(cards()).toHaveLength(48);
    fireEvent.click(within(more).getByRole("button", { name: "Load 2 more" }));
    expect(cards()).toHaveLength(50);
    expect(within(more).queryByRole("button", { name: /Load/ })).toBeNull();
    expect(within(more).getByRole("link", { name: /Browse all products/ })).toBeInTheDocument();
  }, 20_000); // renders 50 product cards in jsdom

  it("empty marketplace: a real empty state, no placeholder products", async () => {
    show(<HomeEmpty />, []);
    const empty = await screen.findByTestId("home-empty");
    expect(empty).toHaveTextContent("No products yet");
    expect(screen.queryAllByRole("article")).toHaveLength(0);
  });

  it("translated and right-to-left (Arabic)", async () => {
    const list = allForYou(many(30));
    show(<MoreForYou products={list} />, list, "ar");
    const more = await screen.findByTestId("shelf-more");
    expect(within(more).getByRole("heading", { name: "مزيد من المنتجات لك" })).toBeInTheDocument();
    expect(within(more).getByRole("button", { name: /تحميل/ })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Source checks
// ---------------------------------------------------------------------------
describe("home page wiring", () => {
  const home = readFileSync(join(process.cwd(), "src/routes/index.tsx"), "utf8");
  it("uses the cached catalog for every shelf (no extra requests, no invented products)", () => {
    expect(home).toContain("useSuspenseQuery(catalogQuery)");
    expect(home).not.toMatch(/supabase|fetch\(/);
    for (const s of ["newArrivals(", "popular(", "categoryShelves(", "allForYou("])
      expect(home).toContain(s);
    expect(home).toContain("<MoreForYou");
    expect(home).toContain("<HomeEmpty");
  });
});
