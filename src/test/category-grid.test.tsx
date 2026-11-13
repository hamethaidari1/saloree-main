import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { createSupabaseMock } from "./supabase-mock";
import { renderWithRouter } from "./router-harness";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

import {
  CATEGORY_IMAGE_ENTRIES,
  CATEGORY_IMAGE_SIZES,
  categoryImage,
} from "@/data/category-images";
import { catalogService } from "@/services/catalog";
import { CategoryGrid } from "@/components/marketplace/category-grid";
import enCategories from "@/locales/en/categories.json";

/** Known slugs show their translated name; unknown ones the database name. */
const shownName = (slug: string, dbName: string) =>
  (enCategories as Record<string, string>)[slug] ?? dbName;

const m = () => mock.current!;
beforeEach(() => m().reset());

const DB_SLUGS = [
  "automotive",
  "beauty-health",
  "books-stationery",
  "electronics",
  "fashion",
  "home-kitchen",
  "sports-outdoors",
  "toys-games",
];

describe("category image map", () => {
  it("has unique slugs, exactly the database categories, each with two WebP sizes", () => {
    const slugs = CATEGORY_IMAGE_ENTRIES.map(([slug]) => slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect([...slugs].sort()).toEqual([...DB_SLUGS].sort());
    for (const [, img] of CATEGORY_IMAGE_ENTRIES) {
      expect(img.small).toMatch(/-400\.webp/);
      expect(img.large).toMatch(/-800\.webp/);
    }
    expect(categoryImage("not-a-category")).toBeUndefined();
  });
});

describe("Find your kind of thing", () => {
  const rows = [
    ...DB_SLUGS.map((slug) => ({ id: slug, slug, name: slug.toUpperCase(), created_at: "" })),
    { id: "x", slug: "garden", name: "Garden", created_at: "" },
  ];

  async function loadCategories() {
    // getCatalog runs products, stores, categories in that order.
    m().state.queue.push({ data: [] }, { data: [] }, { data: rows });
    return (await catalogService.getCatalog()).categories;
  }

  it("never uses a product image for a category", async () => {
    const categories = await loadCategories();
    expect(categories.find((c) => c.slug === "fashion")?.image).toBe(
      categoryImage("fashion")?.large,
    );
    expect(categories.find((c) => c.slug === "garden")?.image).toBe("");
  });

  it("renders one link per database category, in order, plus a neutral tile without an image", async () => {
    const categories = await loadCategories();
    renderWithRouter(<CategoryGrid categories={categories} />);
    const list = await screen.findByRole("list");
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(rows.length);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(
      rows.map((r) => `/category/${r.slug}`),
    );
    expect(links.map((a) => a.textContent)).toEqual(rows.map((r) => shownName(r.slug, r.name)));

    for (const slug of DB_SLUGS) {
      const link = links[DB_SLUGS.indexOf(slug)]!;
      const img = within(link).getByRole("img", { name: shownName(slug, "") });
      expect(img.tagName).toBe("IMG");
      expect(img).toHaveAttribute("loading", "lazy");
      expect(img).toHaveAttribute("decoding", "async");
      expect(img).toHaveAttribute("width", "800");
      expect(img).toHaveAttribute("height", "600");
      expect(img).toHaveAttribute("sizes", CATEGORY_IMAGE_SIZES);
      expect(img.getAttribute("srcset")).toMatch(/400w, .*800w$/);
    }

    const garden = links.at(-1)!;
    expect(garden).toHaveAttribute("data-has-image", "false");
    expect(garden.querySelector("img")).toBeNull();
    // Neutral tile: an icon and the category name, still announced as an image.
    expect(within(garden).getByRole("img", { name: "Garden" })).toHaveClass(
      "category-card-fallback",
    );
    expect(garden.querySelector("svg")).not.toBeNull();
  });
});
