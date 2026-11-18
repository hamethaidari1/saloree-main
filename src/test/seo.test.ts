import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { from: vi.fn(), rpc: vi.fn() } }));

import {
  breadcrumbLd,
  canonicalFor,
  clip,
  ogLocale,
  pageHead,
  productLd,
  seoDescription,
  seoTitle,
  siteOrigin,
  websiteLd,
  type ProductLdInput,
} from "@/lib/seo";
import {
  SITEMAP_MAX_URLS,
  escapeXml,
  sitemapEntries,
  sitemapXml,
  type SitemapData,
} from "@/lib/sitemap";
import { handleSitemap } from "@/lib/sitemap.server";
import { verificationToken } from "@/lib/site-verification";
import { canonicalUrl } from "@/lib/host";
import { productParam, productPath } from "@/services/catalog";

const O = "https://www.saloree.com";
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("canonical URLs", () => {
  it("www host, absolute, no tracking or page-state parameters, no trailing slash", () => {
    expect(siteOrigin("saloree.com")).toBe(O);
    expect(siteOrigin("www.saloree.com")).toBe(O);
    expect(siteOrigin("")).toBeNull();
    expect(
      canonicalFor("/product/blue-mug/?utm_source=x&utm_medium=y&sort=price&page=2#top", O),
    ).toBe(`${O}/product/blue-mug`);
    expect(canonicalFor("/", O)).toBe(`${O}/`);
    expect(canonicalFor("/products?gclid=1&q=mug&brand=Nike", O)).toBe(`${O}/products`);
    expect(canonicalFor("/x", null)).toBeNull();
    // The legal pages' helper agrees.
    expect(canonicalUrl("/legal/terms", { rootDomain: "saloree.com", dev: false })).toBe(
      `${O}/legal/terms`,
    );
  });

  it("product URLs use the slug; old ids still work (the page 301s to the slug)", () => {
    expect(productPath({ id: "6f1c", slug: "blue-mug" })).toBe("/product/blue-mug");
    expect(productParam({ id: "6f1c" })).toBe("6f1c");
    const route = read("src/routes/product.$id.tsx");
    expect(route).toMatch(/if \(product\.slug && params\.id !== product\.slug\)/);
    expect(route).toContain("statusCode: 301");
  });
});

describe("titles and descriptions", () => {
  it("titles fit in 60 characters; the name is shortened, never the suffix", () => {
    const t = seoTitle(
      "OEM ODM 15.6 Inch Portable Monitor Laptop Screen Extension Portable Double Dual Monitor",
      " – Nike | Saloree",
    );
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t.endsWith(" – Nike | Saloree")).toBe(true);
    expect(t).toContain("…");
    expect(seoTitle("Blue mug", " – Nike | Saloree")).toBe("Blue mug – Nike | Saloree");
    expect(seoTitle("Blue mug")).toBe("Blue mug | Saloree");
    // A brand too long for any title: back to " | Saloree".
    expect(seoTitle("Mug", ` – ${"B".repeat(60)} | Saloree`)).toBe("Mug | Saloree");
    expect(clip("one two three four", 10)).toBe("one two…");
  });

  it("descriptions: real sentences, topped up to 120, at most 160", () => {
    const short = seoDescription(
      "A sturdy mug.",
      "Sold by Nordic Goods on Saloree, the marketplace for independent stores.",
      "Blue mug",
    );
    // Under 120 characters, every given part is used (in order), each once.
    expect(short).toBe(
      "A sturdy mug. Sold by Nordic Goods on Saloree, the marketplace for independent stores. Blue mug.",
    );
    const long = seoDescription("word ".repeat(80));
    expect(long.length).toBeLessThanOrEqual(160);
    const filled = seoDescription(
      "This hand-thrown stoneware mug keeps coffee warm and feels good in the hand",
      "Sold by Nordic Goods on Saloree, the marketplace for independent stores.",
    );
    expect(filled.length).toBeGreaterThanOrEqual(120);
    expect(filled.length).toBeLessThanOrEqual(160);
    expect(seoDescription(null, "", "Blue mug")).toBe("Blue mug.");
  });

  it("og:locale for each language", () => {
    expect(ogLocale("fi")).toBe("fi_FI");
    expect(ogLocale("zh-Hant")).toBe("zh_TW");
    expect(ogLocale("xx")).toBe("en_US");
  });
});

describe("page head", () => {
  it("canonical, Open Graph, Twitter and JSON-LD; images absolute", () => {
    const h = pageHead({
      title: "Blue mug | Saloree",
      description: "A sturdy mug.",
      path: "/product/blue-mug?utm_source=x",
      origin: O,
      image: "https://cdn.example/mug.jpg",
      type: "product",
      jsonLd: [websiteLd(O)],
    });
    expect(h.links).toEqual([{ rel: "canonical", href: `${O}/product/blue-mug` }]);
    const meta = h.meta as Record<string, unknown>[];
    const prop = (k: string) =>
      meta.find((m) => m["property"] === k || m["name"] === k)?.["content"];
    expect(prop("og:url")).toBe(`${O}/product/blue-mug`);
    expect(prop("og:type")).toBe("product");
    expect(prop("og:image")).toBe("https://cdn.example/mug.jpg");
    expect(prop("og:site_name")).toBe("Saloree");
    expect(prop("twitter:card")).toBe("summary_large_image");
    expect(meta.filter((m) => "script:ld+json" in m)).toHaveLength(1);
  });

  it("no image of its own: the 1200×630 default; noindex pages get no canonical", () => {
    const h = pageHead({ title: "t", description: "d", path: "/cart", origin: O, noindex: true });
    const meta = h.meta as Record<string, unknown>[];
    expect(meta.find((m) => m["property"] === "og:image")?.["content"]).toBe(`${O}/og-default.png`);
    expect(meta).toContainEqual({ name: "robots", content: "noindex, follow" });
    expect(h.links).toEqual([]);
  });
});

describe("Product JSON-LD: true data only", () => {
  const base: ProductLdInput = {
    id: "p1",
    title: "Blue mug",
    description: "A sturdy mug.",
    images: ["https://cdn.example/1.jpg", "/local.jpg"],
    price: 12.5,
    stock: 3,
    path: "/product/blue-mug",
    store: { name: "Nordic Goods", path: "/store/nordic" },
    rating: 0,
    reviews: 0,
  };

  it("with a brand, in stock, seller, USD, absolute images, sku", () => {
    const ld = productLd({ ...base, brand: "Nike" }, O);
    expect(ld.brand).toEqual({ "@type": "Brand", name: "Nike" });
    expect(ld.sku).toBe("p1");
    expect(ld.image).toEqual(["https://cdn.example/1.jpg", `${O}/local.jpg`]);
    expect(ld.offers).toMatchObject({
      price: "12.50",
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      url: `${O}/product/blue-mug`,
      seller: { name: "Nordic Goods", url: `${O}/store/nordic` },
    });
  });

  it("no brand → no brand; out of stock → OutOfStock; no reviews → no rating", () => {
    const ld = productLd({ ...base, stock: 0 }, O);
    expect(ld).not.toHaveProperty("brand");
    expect(ld.offers.availability).toBe("https://schema.org/OutOfStock");
    expect(ld).not.toHaveProperty("aggregateRating");
    expect(ld).not.toHaveProperty("review");
    // Only with real reviews.
    expect(productLd({ ...base, rating: 4.5, reviews: 2 }, O)).toHaveProperty("aggregateRating");
  });

  it("is valid JSON, and the head escapes '<' so a text can't close the script", () => {
    const ld = productLd({ ...base, title: "</script><b>mug" }, O);
    expect(JSON.parse(JSON.stringify(ld)).name).toBe("</script><b>mug");
    // TanStack renders `script:ld+json` with its HTML escape (< → <).
    const utils = read("node_modules/@tanstack/react-router/dist/esm/headContentUtils.js");
    expect(utils).toMatch(/"script:ld\+json" in m[\s\S]*escapeHtml\(json\)/);
  });

  it("breadcrumbs: positions and absolute URLs", () => {
    expect(
      breadcrumbLd(
        [
          { name: "Home", path: "/" },
          { name: "Mug", path: "/product/blue-mug" },
        ],
        O,
      ).itemListElement,
    ).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: `${O}/` },
      { "@type": "ListItem", position: 2, name: "Mug", item: `${O}/product/blue-mug` },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Sitemap
// ---------------------------------------------------------------------------
const product = (patch: Partial<SitemapData["products"][number]> = {}) => ({
  id: "p",
  slug: "blue-mug",
  status: "active",
  created_at: "2026-11-01T10:00:00Z",
  price: 20,
  category: "home",
  store_status: "published",
  ...patch,
});
const data = (patch: Partial<SitemapData> = {}): SitemapData => ({
  products: [product()],
  stores: [{ slug: "nordic", status: "published", updated_at: "2026-11-02T00:00:00Z" }],
  categories: [{ slug: "home" }, { slug: "toys" }],
  legal: [{ slug: "terms", updated: "2026-10-01" }],
  ...patch,
});

describe("sitemap", () => {
  it("public pages only: no drafts, inactive products, unpublished stores or empty categories", () => {
    const paths = sitemapEntries(
      data({
        products: [
          product(),
          product({ id: "d", slug: "draft", status: "draft" }),
          product({ id: "u", slug: "hidden-store", store_status: "draft" }),
          product({ id: "x", slug: null }),
        ],
        stores: [
          { slug: "nordic", status: "published", updated_at: null },
          { slug: "draft-store", status: "draft", updated_at: null },
        ],
      }),
    ).map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "/",
        "/products",
        "/stores",
        "/legal",
        "/legal/terms",
        "/category/home",
        "/store/nordic",
        "/product/blue-mug",
        "/product/x",
      ]),
    );
    for (const gone of [
      "/product/draft",
      "/product/hidden-store",
      "/store/draft-store",
      "/category/toys",
    ])
      expect(paths).not.toContain(gone);
    for (const noindex of ["/cart", "/checkout", "/account", "/admin", "/seller", "/login"])
      expect(paths).not.toContain(noindex);
  });

  it("a category with only pricier products is listed (no default price filter any more)", () => {
    const paths = sitemapEntries(data({ products: [product({ price: 249.99 })] })).map(
      (e) => e.path,
    );
    expect(paths).toContain("/category/home");
    expect(paths).toContain("/product/blue-mug");
  });

  it("XML: absolute www URLs, lastmod as a date, escaped", () => {
    const xml = sitemapXml(sitemapEntries(data()), O, null)!;
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml).toContain(`<loc>${O}/product/blue-mug</loc><lastmod>2026-11-01</lastmod>`);
    expect(xml).toContain(`<loc>${O}/store/nordic</loc><lastmod>2026-11-02</lastmod>`);
    expect(escapeXml(`a&b<c>"d'`)).toBe("a&amp;b&lt;c&gt;&quot;d&apos;");
  });

  it("over 5,000 URLs: a sitemap index of parts", () => {
    const many = Array.from({ length: SITEMAP_MAX_URLS + 10 }, (_, i) => ({
      path: `/product/p${i}`,
    }));
    const index = sitemapXml(many, O, null)!;
    expect(index).toContain("<sitemapindex");
    expect(index).toContain(`${O}/sitemap.xml?part=2`);
    expect(index).not.toContain("part=3");
    expect((sitemapXml(many, O, 2)!.match(/<url>/g) ?? []).length).toBe(10);
    expect(sitemapXml(many, O, 3)).toBeNull();
  });

  it("the route: XML cached for an hour; an error is never cached", async () => {
    vi.stubEnv("VITE_ROOT_DOMAIN", "saloree.com");
    const ok = await handleSitemap(new Request(`${O}/sitemap.xml`), async () => data());
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("application/xml");
    expect(ok.headers.get("cache-control")).toBe("public, max-age=3600, s-maxage=3600");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failed = await handleSitemap(new Request(`${O}/sitemap.xml`), async () => {
      throw new Error("down");
    });
    expect(failed.status).toBe(503);
    expect(failed.headers.get("cache-control")).toBe("no-store");
    warn.mockRestore();
    vi.unstubAllEnvs();
  });

  it("robots.txt: public pages open, private ones closed, sitemap listed", () => {
    const robots = read("public/robots.txt");
    for (const line of [
      "Disallow: /admin",
      "Disallow: /seller",
      "Disallow: /api/",
      "Disallow: /cart",
      "Disallow: /checkout",
      "Disallow: /account",
    ])
      expect(robots).toContain(line);
    expect(robots).toContain("Sitemap: https://www.saloree.com/sitemap.xml");
    expect(robots).toMatch(/User-agent: \*\nAllow: \//);
  });
});

describe("Search Console verification", () => {
  it("takes only a token from GOOGLE_SITE_VERIFICATION", () => {
    expect(verificationToken(" abcDEF123_-xyz ")).toBe("abcDEF123_-xyz");
    expect(verificationToken('<meta name="google-site-verification" content="x">')).toBeNull();
    expect(verificationToken("")).toBeNull();
    expect(verificationToken(undefined)).toBeNull();
    expect(read("src/lib/site-verification.ts")).toContain(
      'process.env["GOOGLE_SITE_VERIFICATION"]',
    );
  });
});
