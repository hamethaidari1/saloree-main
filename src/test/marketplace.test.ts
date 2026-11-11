import { describe, expect, it } from "vitest";
import { products, stores, categories } from "@/data/catalog";
import { cartTotal, normalizeCart, updateCart } from "@/services/cart";
import { filterProducts, initialsFor, toProduct, toStore } from "@/services/catalog";
import { safeRedirect } from "@/lib/auth";
const catalog = { products, stores };
describe("Marketplace catalog fixtures", () => {
  it("has at least 24 products", () => expect(products.length).toBeGreaterThanOrEqual(24));
  it("has six categories represented in the catalog", () => {
    expect(categories).toHaveLength(6);
    expect(new Set(products.map((p) => p.category)).size).toBe(6);
  });
  it("filters to one seller without leaking other sellers", () => {
    const result = filterProducts({ store: "terra-home" }, catalog);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.storeSlug === "terra-home")).toBe(true);
  });
  it("searches product titles and sorts by price", () => {
    expect(filterProducts({ query: "headphones" }, catalog).map((p) => p.id)).toEqual(["3"]);
    const sorted = filterProducts({ sort: "price-low" }, catalog);
    expect(sorted[0]?.price).toBe(18);
  });
});
describe("Supabase row mapping", () => {
  const row = {
    id: "074fe87b-ca8f-41d9-85f8-35f63e138062",
    store_id: "s1",
    category_id: "c1",
    title: "Desk Fan",
    slug: "desk-fan",
    description: null,
    price: 14.99,
    compare_price: 19.99,
    stock: 5,
    featured_image: null,
    status: "active",
    created_at: "2026-07-08T08:14:49.532074+00:00",
    stores: { slug: "nextgen-tech", status: "published" },
    categories: { slug: "electronics" },
    product_images: [
      { image_url: "b.jpg", sort_order: 2 },
      { image_url: "a.jpg", sort_order: 1 },
    ],
  };
  it("maps a product row to the UI shape", () => {
    const p = toProduct(row);
    expect(p).toMatchObject({
      storeSlug: "nextgen-tech",
      category: "electronics",
      originalPrice: 19.99,
      badge: "Sale",
      image: "a.jpg",
      rating: 0,
      description: "",
    });
  });
  it("omits the sale price when compare_price is not higher", () =>
    expect(toProduct({ ...row, compare_price: 10 }).originalPrice).toBeUndefined());
  it("derives store initials and a valid tone", () => {
    expect(initialsFor("NextGen Tech")).toBe("nt");
    const s = toStore({
      id: "s1",
      owner_id: "u1",
      name: "NextGen Tech",
      slug: "nextgen-tech",
      description: null,
      logo_url: "logo.png",
      banner_url: null,
      category: "Electronics",
      location: null,
      status: "published",
      created_at: "",
      updated_at: "",
    });
    expect(["sage", "rose", "blue", "peach"]).toContain(s.tone);
    expect(s.image).toBe("logo.png");
  });
});
describe("Shared cart", () => {
  it("combines products from different stores in one total", () =>
    expect(
      cartTotal(
        [
          { productId: "1", quantity: 2 },
          { productId: "3", quantity: 1 },
        ],
        products,
      ),
    ).toBe(137));
  it("updates quantities and removes items", () => {
    const items = updateCart([], "1", 2, products);
    expect(items).toEqual([{ productId: "1", quantity: 2 }]);
    expect(updateCart(items, "1", 0, products)).toEqual([]);
  });
  it("caps quantity at available stock", () =>
    expect(updateCart([], "1", 100, products)[0]?.quantity).toBe(12));
  it("does not add out-of-stock products", () =>
    expect(updateCart([], "x", 1, [{ id: "x", stock: 0, price: 5 }])).toEqual([]));
  it("restores only valid saved items", () =>
    expect(
      normalizeCart(
        [
          { productId: "1", quantity: 2 },
          { productId: "missing", quantity: 1 },
          { productId: "3", quantity: -1 },
        ],
        products,
      ),
    ).toEqual([{ productId: "1", quantity: 2 }]));
});
describe("Auth redirects", () => {
  it("only allows same-origin paths", () => {
    expect(safeRedirect("/seller")).toBe("/seller");
    expect(safeRedirect("//evil.example")).toBe("/");
    expect(safeRedirect("https://evil.example")).toBe("/");
    expect(safeRedirect(undefined, "/account")).toBe("/account");
  });
});
