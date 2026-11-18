import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { createSupabaseMock } from "./supabase-mock";
import { renderWithRouter, testQueryClient } from "./router-harness";
import { WithLocale } from "./i18n";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});
// The upload test replaces the browser codec (jsdom has no canvas encoder).
vi.mock("@/lib/image-optimize", async (orig) => {
  const real = await orig<typeof import("@/lib/image-optimize")>();
  return {
    ...real,
    // A test's own codec is used as given; the app's calls (no codec) get the fake one.
    optimizeImage: vi.fn(
      (file: File, preset: Parameters<typeof real.optimizeImage>[1], codec?: ImageCodec) =>
        real.optimizeImage(file, preset, codec ?? fakeCodec({ width: 4000, height: 3000 }).codec),
    ),
  };
});

import {
  fitWithin,
  ImageOptimizeError,
  isOptimizedUrl,
  MAX_INPUT_BYTES,
  optimizeImage,
  PRESETS,
  thumbOrFull,
  thumbUrl,
  type ImageCodec,
} from "@/lib/image-optimize";
import { sellerService } from "@/services/seller";
import { catalogQuery, priceBounds, priceStep } from "@/services/catalog";
import { categoryProducts } from "@/lib/seo-pages";
import { Browse } from "@/components/marketplace/browse";
import { CartProvider } from "@/components/marketplace/cart-context";
import type { Catalog, Product } from "@/data/catalog";

const m = () => mock.current!;

/**
 * A stand-in for the canvas: the "file" is `bytesPerPixel × pixels × quality`
 * bytes, and the type is the one asked for unless WebP is "unsupported".
 */
function fakeCodec(
  img: { width: number; height: number },
  opts: { webp?: boolean; bytesPerPixel?: number; failDecode?: boolean } = {},
) {
  const calls: { width: number; height: number; mime: string; quality: number }[] = [];
  const codec: ImageCodec = {
    decode: async () => {
      if (opts.failDecode) throw new Error("bad");
      return { ...img, source: "bitmap", close: vi.fn() };
    },
    encode: async (_s, size, mime, quality) => {
      calls.push({ ...size, mime, quality });
      const type = mime === "image/webp" && opts.webp === false ? "image/png" : mime;
      const bytes = Math.round(size.width * size.height * (opts.bytesPerPixel ?? 0.05) * quality);
      return new Blob([new Uint8Array(bytes)], { type });
    },
  };
  return { codec, calls };
}
const photo = (size = 3_000_000, type = "image/jpeg") =>
  new File([new Uint8Array(size)], "photo.jpg", { type });

// ---------------------------------------------------------------------------
// Resize / convert
// ---------------------------------------------------------------------------
describe("image optimizer", () => {
  it("fits the longest side and never enlarges", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });

  it("product: 1600 px WebP within 300 KB, plus a 480 px thumbnail", async () => {
    const { codec, calls } = fakeCodec({ width: 4000, height: 3000 });
    const out = await optimizeImage(photo(), "product", codec);
    expect(out).toMatchObject({ mime: "image/webp", ext: "webp", width: 1600, height: 1200 });
    expect(out.main.size).toBeLessThanOrEqual(PRESETS.product.targetBytes);
    expect(out.thumb?.type).toBe("image/webp");
    expect(calls.at(-1)).toMatchObject({ width: 480, height: 360, quality: 0.75 });
    expect(calls[0]).toMatchObject({ width: 1600, quality: 0.82 });
  });

  it("banner 1920 px, logo 512 px; chat photos have no thumbnail", async () => {
    const big = { width: 6000, height: 2000 };
    expect(await optimizeImage(photo(), "banner", fakeCodec(big).codec)).toMatchObject({
      width: 1920,
      height: 640,
    });
    expect(await optimizeImage(photo(), "logo", fakeCodec(big).codec)).toMatchObject({
      width: 512,
    });
    expect((await optimizeImage(photo(), "attachment", fakeCodec(big).codec)).thumb).toBeNull();
  });

  it("steps quality, then size, down until the file is within its target", async () => {
    const { codec, calls } = fakeCodec({ width: 4000, height: 3000 }, { bytesPerPixel: 0.4 });
    const out = await optimizeImage(photo(), "product", codec);
    expect(out.main.size).toBeLessThanOrEqual(PRESETS.product.targetBytes);
    expect(new Set(calls.map((c) => c.quality)).size).toBeGreaterThan(2);
    expect(out.width).toBeLessThan(1600);
    expect(out.width).toBeGreaterThanOrEqual(640);
  });

  it("falls back to JPEG where the browser can't write WebP", async () => {
    const { codec } = fakeCodec({ width: 2000, height: 2000 }, { webp: false });
    const out = await optimizeImage(photo(), "product", codec);
    expect(out).toMatchObject({ mime: "image/jpeg", ext: "jpg" });
    expect(out.main.type).toBe("image/jpeg");
    expect(out.thumb?.type).toBe("image/jpeg");
  });

  it("refuses non-images, SVG, unreadable files and inputs over 15 MB, with a clear message", async () => {
    const { codec } = fakeCodec({ width: 10, height: 10 });
    await expect(
      optimizeImage(new File(["x"], "doc.pdf", { type: "application/pdf" }), "product", codec),
    ).rejects.toMatchObject({ problem: "notImage" });
    await expect(
      optimizeImage(new File(["<svg/>"], "a.svg", { type: "image/svg+xml" }), "product", codec),
    ).rejects.toMatchObject({ problem: "notImage" });
    await expect(optimizeImage(photo(MAX_INPUT_BYTES + 1), "product", codec)).rejects.toThrow(
      /over 15 MB/,
    );
    await expect(
      optimizeImage(
        photo(),
        "product",
        fakeCodec({ width: 1, height: 1 }, { failDecode: true }).codec,
      ),
    ).rejects.toBeInstanceOf(ImageOptimizeError);
  });

  it("thumbnail URLs follow from the optimized name; old photos keep their URL", () => {
    const opt = "https://x.supabase.co/storage/v1/object/public/product-images/u/p/abc.opt.webp";
    expect(thumbUrl(opt)).toBe(
      "https://x.supabase.co/storage/v1/object/public/product-images/u/p/abc.thumb.webp",
    );
    expect(thumbUrl(`${opt}?v=2`)).toMatch(/abc\.thumb\.webp\?v=2$/);
    const old = "https://x.supabase.co/storage/v1/object/public/product-images/u/p/abc.webp";
    expect(thumbUrl(old)).toBe(old);
    expect(thumbUrl(null)).toBeNull();
    expect(isOptimizedUrl(opt)).toBe(true);
    expect(isOptimizedUrl(old)).toBe(false);
    // A missing thumbnail falls back to the full image, once.
    const img = document.createElement("img");
    img.setAttribute("src", thumbUrl(opt));
    thumbOrFull(opt)({ currentTarget: img });
    expect(img.getAttribute("src")).toBe(opt);
  });
});

// ---------------------------------------------------------------------------
// Uploads never send the original
// ---------------------------------------------------------------------------
describe("uploads", () => {
  it("uploads the thumbnail, then the optimized file; returns the optimized URL", async () => {
    m().reset();
    m().state.session = { user: { id: "user-1" } };
    const url = await sellerService.uploadStoreImage("banner", photo(3_000_000));
    const paths = m().state.uploads.map((u) => u.path);
    expect(m().state.uploads.map((u) => u.bucket)).toEqual(["store-banners", "store-banners"]);
    expect(paths[0]).toMatch(/^user-1\/banners\/[0-9a-f-]{36}\.thumb\.webp$/);
    expect(paths[1]).toMatch(/^user-1\/banners\/[0-9a-f-]{36}\.opt\.webp$/);
    expect(paths.some((p) => p.endsWith(".jpg"))).toBe(false);
    expect(url).toMatch(/\.opt\.webp$/);
  });
});

// ---------------------------------------------------------------------------
// Price filter: no hidden products by default
// ---------------------------------------------------------------------------
const product = (id: string, price: number, patch: Partial<Product> = {}): Product => ({
  id,
  title: `Product ${id}`,
  price,
  rating: 0,
  reviews: 0,
  storeSlug: "nordic",
  category: "tech",
  image: "https://img.example/p.jpg",
  stock: 3,
  description: "",
  createdAt: Date.parse("2026-11-01") + Number(id.replace(/\D/g, "") || 0),
  ...patch,
});

describe("price filter", () => {
  it("the slider's range is the real cheapest–dearest price", () => {
    expect(priceBounds([product("1", 9.5), product("2", 249.99)])).toEqual({ min: 9, max: 250 });
    expect(priceBounds([])).toEqual({ min: 0, max: 0 });
    expect(priceStep({ min: 0, max: 50 })).toBe(1);
    expect(priceStep({ min: 0, max: 2000 })).toBe(20);
  });

  it("products over $200 show without touching the slider", async () => {
    const catalog: Catalog = {
      products: [product("1", 20), product("2", 249.99), product("3", 999)],
      categories: [{ slug: "tech", name: "Tech", image: "" }],
      stores: [
        {
          slug: "nordic",
          name: "Nordic",
          initials: "n",
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
    const client = testQueryClient();
    client.setQueryData(catalogQuery.queryKey, catalog);
    renderWithRouter(
      <WithLocale>
        <CartProvider>
          <Browse category="tech" />
        </CartProvider>
      </WithLocale>,
      "/",
      client,
    );
    expect(await screen.findByText("Product 3")).toBeInTheDocument();
    expect(screen.getByText("Product 2")).toBeInTheDocument();
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("min", "20");
    expect(slider).toHaveAttribute("max", "999");
    expect(slider).toHaveValue("999");
    expect(within(slider.parentElement!).getByText(/999/)).toBeInTheDocument();
    // The category's structured data lists the same products.
    expect(categoryProducts("tech", catalog.products).map((p) => p.id)).toEqual(["3", "2", "1"]);
  });
});
