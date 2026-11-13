import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { imagesOf, productImageList, toProduct } from "@/services/catalog";
import { templateDataFromSeller } from "@/templates/data";
import { ProductGallery } from "@/components/marketplace/product-gallery";
import { ProductForm } from "@/components/seller/product-form";
import type { SellerProduct } from "@/services/seller";
import type { StoreRow } from "@/data/db";
import { WithLocale } from "./i18n";

const url = (n: number) => `https://img.example/p/${n}.jpg`;
/** The real shape of the reported product: 5 rows, sort 0..4, row 0 = featured. */
const rows = [3, 0, 4, 1, 2].map((n) => ({ image_url: url(n), sort_order: n })); // unsorted on purpose
const productRow = (patch: Record<string, unknown> = {}) => ({
  id: "90658135-1480-4f6d-a438-dd4c092b6ded",
  store_id: "s1",
  category_id: null,
  title: "Portable Monitor",
  slug: "portable-monitor",
  description: null,
  price: 120,
  compare_price: null,
  stock: 4,
  featured_image: url(0),
  status: "active",
  created_at: "2026-11-01T00:00:00Z",
  stores: { slug: "nexio", status: "published" },
  categories: null,
  product_images: rows,
  ...patch,
});

describe("product images data path", () => {
  it("all 5 photos, in sort_order, featured first and not duplicated", () => {
    expect(productImageList(url(0), rows)).toEqual([0, 1, 2, 3, 4].map(url));
  });
  it("featured that isn't in the rows goes first; blanks are dropped", () => {
    expect(productImageList(url(9), [{ image_url: url(1), sort_order: 1 }])).toEqual([
      url(9),
      url(1),
    ]);
    expect(
      productImageList("", [
        { image_url: " ", sort_order: 0 },
        { image_url: url(1), sort_order: 1 },
      ]),
    ).toEqual([url(1)]);
  });
  it("no extra rows: the featured image alone", () => {
    expect(productImageList(url(0), [])).toEqual([url(0)]);
    expect(productImageList(url(0), null)).toEqual([url(0)]);
  });
  it("toProduct keeps every photo (the page used to get only one)", () => {
    const p = toProduct(productRow() as Parameters<typeof toProduct>[0]);
    expect(p.image).toBe(url(0));
    expect(p.images).toEqual([0, 1, 2, 3, 4].map(url));
    const single = toProduct(productRow({ product_images: [] }) as Parameters<typeof toProduct>[0]);
    expect(single.images).toEqual([url(0)]);
    expect(imagesOf({ image: url(7) })).toEqual([url(7)]); // fixtures without `images`
  });
  it("store templates (seller preview) get the same list", () => {
    const data = templateDataFromSeller(
      { id: "s1", slug: "nexio", name: "Nexio", status: "published" } as StoreRow,
      [
        {
          ...productRow(),
          product_images: rows.map((r, i) => ({ ...r, id: `i${i}`, product_id: "x" })),
        } as unknown as SellerProduct,
      ],
      [],
    );
    expect(data.products[0]?.images).toEqual([0, 1, 2, 3, 4].map(url));
    expect(data.products[0]?.image).toBe(url(0));
  });
});

describe("product page gallery", () => {
  const show = (images: string[], locale: "en" | "ar" = "en") =>
    render(
      <WithLocale locale={locale}>
        <ProductGallery title="Portable Monitor" images={images} />
      </WithLocale>,
    );
  const main = () => document.querySelector<HTMLImageElement>(".detail-photo img")!;

  it("5 photos → 5 thumbnails, in order; the first is shown", () => {
    show([0, 1, 2, 3, 4].map(url));
    const bar = screen.getByRole("toolbar", { name: "Product photos" });
    const thumbs = within(bar).getAllByRole("button");
    expect(thumbs.map((b) => b.querySelector("img")!.getAttribute("src"))).toEqual(
      [0, 1, 2, 3, 4].map(url),
    );
    expect(thumbs.map((b) => b.getAttribute("aria-label"))).toEqual(
      [1, 2, 3, 4, 5].map((n) => `Show photo ${n} of 5`),
    );
    expect(main()).toHaveAttribute("src", url(0));
    expect(main()).toHaveAttribute("alt", "Portable Monitor, photo 1 of 5");
    expect(thumbs[0]).toHaveAttribute("aria-pressed", "true");
  });

  it("click and keyboard (arrows, Home, End; one Tab stop) change the photo", () => {
    show([0, 1, 2, 3, 4].map(url));
    const thumbs = within(screen.getByRole("toolbar")).getAllByRole("button");
    expect(thumbs.map((b) => b.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    fireEvent.click(thumbs[2]!);
    expect(main()).toHaveAttribute("src", url(2));
    fireEvent.keyDown(thumbs[2]!, { key: "ArrowRight" });
    expect(main()).toHaveAttribute("src", url(3));
    expect(document.activeElement).toBe(thumbs[3]);
    fireEvent.keyDown(thumbs[3]!, { key: "End" });
    expect(main()).toHaveAttribute("src", url(4));
    fireEvent.keyDown(thumbs[4]!, { key: "ArrowRight" }); // wraps
    expect(main()).toHaveAttribute("src", url(0));
    fireEvent.keyDown(thumbs[0]!, { key: "ArrowLeft" });
    expect(main()).toHaveAttribute("src", url(4));
    fireEvent.keyDown(thumbs[4]!, { key: "Home" });
    expect(main()).toHaveAttribute("src", url(0));
    expect(thumbs[0]).toHaveAttribute("tabindex", "0");
  });

  it("right-to-left: the arrow keys follow the reading direction", () => {
    show([0, 1, 2].map(url), "ar");
    const thumbs = within(screen.getByRole("toolbar")).getAllByRole("button");
    fireEvent.keyDown(thumbs[0]!, { key: "ArrowLeft" });
    expect(main()).toHaveAttribute("src", url(1));
  });

  it("only the featured image: shown, no thumbnail strip", () => {
    show([url(0)]);
    expect(main()).toHaveAttribute("src", url(0));
    expect(main()).toHaveAttribute("alt", "Portable Monitor");
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
});

describe("seller edit form", () => {
  it("shows all 5 images of the product once each (cover first)", () => {
    const product = {
      ...productRow(),
      product_images: [0, 1, 2, 3, 4].map((n) => ({
        id: `i${n}`,
        product_id: "x",
        image_url: url(n),
        sort_order: n,
      })),
    } as unknown as SellerProduct;
    render(
      <ProductForm
        product={product}
        categories={[]}
        busy={false}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const imgs = screen.getAllByRole("img", { name: /^Product image \d$/ });
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([0, 1, 2, 3, 4].map(url));
  });
});
