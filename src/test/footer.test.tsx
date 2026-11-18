import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { createSupabaseMock } from "./supabase-mock";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

import { SiteFooter } from "@/components/marketplace/footer";
import { logoSrc, PAYMENT_BRANDS } from "@/lib/payment-logos";
import {
  EMPTY_FOOTER,
  safeFooterUrl,
  siteService,
  toFooterContent,
  type FooterContent,
} from "@/services/site";
import {
  DEFAULT_INSTAGRAM_URL,
  DEFAULT_TIKTOK_URL,
  companyDetailsSchema,
  mergeCompanyDetails,
} from "@/services/finance";
import type { FooterLinkRow, SiteSettingsFooterRow } from "@/data/db";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const m = () => mock.current!;
beforeEach(() => m().reset());

const CATEGORIES = [
  { slug: "automotive", name: "Automotive" },
  { slug: "beauty-health", name: "Beauty & Health" },
  { slug: "books-stationery", name: "Books & Stationery" },
  { slug: "electronics", name: "Electronics" },
  { slug: "fashion", name: "Fashion" },
];

/** A router with a few real-looking routes, so footer_links paths can be checked. */
async function renderFooter(content: FooterContent) {
  const root = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <SiteFooter categories={CATEGORIES} content={content} />
      </>
    ),
  });
  const page = (path: string) => createRoute({ getParentRoute: () => root, path });
  const router = createRouter({
    routeTree: root.addChildren(["/", "/products", "/stores", "/help"].map(page)),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  // Inside this render only: a test may render several footers.
  const footer = await within(view.container).findByRole("contentinfo");
  return { ...view, footer };
}

const settings = (patch: Partial<SiteSettingsFooterRow> = {}): SiteSettingsFooterRow => ({
  footer_description: null,
  copyright_text: null,
  facebook_url: null,
  instagram_url: null,
  twitter_url: null,
  footer_settings: {},
  ...patch,
});

describe("site footer: default columns", () => {
  it("renders only real links: every href is a non-empty internal path", async () => {
    const { footer } = await renderFooter(EMPTY_FOOTER);
    const links = within(footer).getAllByRole("link");
    for (const a of links) {
      const href = a.getAttribute("href") ?? "";
      expect(href, a.textContent ?? "").toMatch(/^\/[^/]?/);
    }
    const hrefs = links.map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/products",
        "/products?sort=newest",
        "/stores",
        "/products?sort=popular",
        "/category/automotive",
        "/register?role=seller",
        "/seller",
        "/account",
        "/account#my-orders",
        "/cart",
        "/help",
        "/",
      ]),
    );
    // Only the first 4 database categories.
    expect(hrefs).not.toContain("/category/fashion");
    // The legal pages in src/content/legal are linked; pages we don't have never are.
    expect(hrefs).toEqual(
      expect.arrayContaining([
        "/legal/terms",
        "/legal/privacy",
        "/legal/returns",
        "/legal/shipping",
        "/legal/seller-agreement",
      ]),
    );
    const text = footer.textContent ?? "";
    for (const missing of ["Contact", "About"]) expect(text).not.toContain(missing);
  });

  it("has 4 headed columns, payment methods, Back to top and no unverifiable claims", async () => {
    const { footer } = await renderFooter(EMPTY_FOOTER);
    expect(
      within(footer)
        .getAllByRole("heading", { level: 2 })
        .map((h) => h.textContent),
    ).toEqual(["Shop", "Sell on Saloree", "Your account", "Help and policies", "Payment methods"]);
    expect(within(footer).getByRole("button", { name: /back to top/i })).toBeTruthy();
    expect(footer.textContent).not.toMatch(/SSL|guarantee|verified|certified|100%|secured by/i);
    expect(footer.textContent).toContain("Cash on delivery");
  });

  it("uses '© <year> Saloree' and hides company details and social links when missing/hidden", async () => {
    const { footer } = await renderFooter(
      toFooterContent(
        settings({ footer_settings: { instagram_url: "hide", tiktok_url: "hide" } }),
        [],
      ),
    );
    expect(screen.getByTestId("footer-copyright").textContent).toBe(
      `© ${new Date().getFullYear()} Saloree`,
    );
    expect(screen.queryByTestId("footer-company")).toBeNull();
    expect(footer.textContent).not.toMatch(/Business ID/);
    expect(within(footer).queryByRole("list", { name: /social media/i })).toBeNull();
  });

  it("shows copyright, tagline, company details and social links when present", async () => {
    const content = toFooterContent(
      settings({
        copyright_text: "© 2026 Saloree Ltd.",
        footer_description: "Independent stores, one cart.",
        footer_settings: {
          legal_name: "Saloree Trading LLC",
          business_id: "AF-123456",
          address: "Kabul, Afghanistan",
          instagram_url: "https://www.instagram.com/saloreecom/",
          tiktok_url: "hide",
        },
      }),
      [],
    );
    const { footer } = await renderFooter(content);
    expect(screen.getByTestId("footer-copyright").textContent).toBe("© 2026 Saloree Ltd.");
    expect(footer.textContent).toContain("Independent stores, one cart.");
    const company = screen.getByTestId("footer-company");
    expect(company.textContent).toContain("Saloree Trading LLC");
    expect(company.textContent).toContain("Business ID: AF-123456");
    expect(company.textContent).toContain("Kabul, Afghanistan");
    const social = within(footer).getByRole("list", { name: /social media/i });
    const socialLinks = within(social).getAllByRole("link");
    expect(socialLinks).toHaveLength(1);
    expect(socialLinks[0]).toHaveAttribute("href", "https://www.instagram.com/saloreecom/");
    expect(socialLinks[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(socialLinks[0]).toHaveAttribute("target", "_blank");
    expect(socialLinks[0]).toHaveAccessibleName(/Instagram/);
  });
});

describe("site footer: payment methods", () => {
  afterEach(() => vi.unstubAllEnvs());
  const payments = (footer: HTMLElement) =>
    within(footer).getByRole("region", { name: "Payment methods" });

  it("flag off: cash on delivery only, no card logos and no Stripe claim", async () => {
    vi.stubEnv("VITE_STRIPE_ENABLED", "false");
    const { footer } = await renderFooter(EMPTY_FOOTER);
    const section = payments(footer);
    expect(section.textContent).toContain("Cash on delivery");
    expect(within(section).queryAllByRole("img")).toHaveLength(0);
    expect(screen.queryAllByTestId("card-brand")).toHaveLength(0);
    expect(footer.textContent).not.toMatch(
      /Visa|Mastercard|Maestro|American Express|Apple Pay|Google Pay|Stripe/,
    );
  });

  it("flag on: exactly the six logos with alt text, plus the Stripe line", async () => {
    vi.stubEnv("VITE_STRIPE_ENABLED", "true");
    const { footer } = await renderFooter(EMPTY_FOOTER);
    const section = payments(footer);
    expect(section.textContent).toContain("Cash on delivery");
    const imgs = within(section).getAllByRole("img");
    expect(imgs.map((i) => i.getAttribute("alt"))).toEqual([
      "Visa",
      "Mastercard",
      "Maestro",
      "American Express",
      "Apple Pay",
      "Google Pay",
    ]);
    for (const img of imgs) {
      expect(img).toHaveAttribute("loading", "lazy");
      expect(img).toHaveAttribute("width", "60");
      expect(img).toHaveAttribute("height", "50");
    }
    expect(section.textContent).toContain(
      "Card payments are processed securely by Stripe. We never see or store your card details.",
    );
    // nothing that isn't really accepted
    expect(section.innerHTML).not.toMatch(
      /discover|diners|unionpay|v ?pay|contactless|paypal|klarna/i,
    );
  });

  it("a missing logo file falls back to a text badge", async () => {
    vi.stubEnv("VITE_STRIPE_ENABLED", "true");
    const { footer } = await renderFooter(EMPTY_FOOTER);
    const section = payments(footer);
    fireEvent.error(within(section).getByAltText("Maestro"));
    expect(within(section).queryByAltText("Maestro")).toBeNull();
    expect(within(section).getByText("Maestro")).toBeTruthy();
    // the others still show their logo
    expect(within(section).getByAltText("Visa")).toBeTruthy();
    expect(within(section).getAllByTestId("card-brand")).toHaveLength(6);
  });

  it("with all six files missing, every brand still shows as text", async () => {
    vi.stubEnv("VITE_STRIPE_ENABLED", "true");
    const { footer } = await renderFooter(EMPTY_FOOTER);
    const section = payments(footer);
    for (const img of within(section).getAllByRole("img")) fireEvent.error(img);
    expect(within(section).queryAllByRole("img")).toHaveLength(0);
    for (const b of PAYMENT_BRANDS) expect(within(section).getByText(b.name)).toBeTruthy();
  });

  it("every image is a local file; no external URLs and nothing secret-looking", async () => {
    vi.stubEnv("VITE_STRIPE_ENABLED", "true");
    const { footer } = await renderFooter(EMPTY_FOOTER);
    const srcs = [...footer.querySelectorAll("img")].map((i) => i.getAttribute("src") ?? "");
    expect(srcs.length).toBeGreaterThan(0);
    for (const src of srcs) expect(src).toMatch(/^\/(?!\/)/);
    expect(PAYMENT_BRANDS.map(logoSrc)).toEqual([
      "/payment-logos/visa.png",
      "/payment-logos/mastercard.png",
      "/payment-logos/maestro.png",
      "/payment-logos/amex.png",
      "/payment-logos/apple-pay.png",
      "/payment-logos/google-pay.png",
    ]);
    // Built from parts so the repo-wide secret scan doesn't flag this test itself.
    const secretLike = new RegExp(["\b(sk|pk|rk)_(live|test)_", "wh" + "sec_"].join("|"));
    expect(footer.innerHTML).not.toMatch(secretLike);
  });
});

describe("site footer: company line", () => {
  it("uses '© <year> <legal name>' and lists only the filled fields", async () => {
    const content = toFooterContent(
      settings({ footer_settings: { legal_name: "Example Oy", business_id: "", address: "  " } }),
      [],
    );
    await renderFooter(content);
    expect(screen.getByTestId("footer-copyright").textContent).toBe(
      `© ${new Date().getFullYear()} Example Oy`,
    );
    // the name is already in the copyright line; nothing else is filled
    expect(screen.queryByTestId("footer-company")).toBeNull();
  });

  it("shows business ID and email only when filled, never the empty labels", async () => {
    const content = toFooterContent(
      settings({
        footer_settings: { legal_name: "Example Oy", business_id: "1234567-8", support_email: "" },
      }),
      [],
    );
    const { footer } = await renderFooter(content);
    const company = screen.getByTestId("footer-company");
    expect(company.textContent).toBe("Business ID: 1234567-8");
    expect(footer.textContent).not.toMatch(/Support:/);
    expect(within(company).queryByRole("link")).toBeNull();
  });
});

describe("site footer: footer_links rows", () => {
  const row = (patch: Partial<FooterLinkRow>): FooterLinkRow => ({
    id: Math.random().toString(36),
    category: "Shop",
    label: "Products",
    url: "/products",
    display_order: 0,
    is_active: true,
    ...patch,
  });

  it("builds columns from rows, drops unsafe URLs and paths that are not routes", async () => {
    const content = toFooterContent(null, [
      row({ category: "Help", label: "Customer Service", url: "/help", display_order: 3 }),
      row({ label: "All products", url: "/products", display_order: 1 }),
      row({ label: "About", url: "/about", display_order: 2 }), // page doesn't exist
      row({ label: "Evil", url: "javascript:alert(1)", display_order: 4 }),
      row({ label: "Hidden", url: "/stores", is_active: false }),
      row({
        category: "Elsewhere",
        label: "Blog",
        url: "https://blog.saloree.com",
        display_order: 5,
      }),
    ]);
    expect(content.columns.map((c) => c.heading)).toEqual(["Shop", "Help", "Elsewhere"]);
    const { footer } = await renderFooter(content);
    const links = within(footer.querySelector("nav")!).getAllByRole("link");
    // The policies column is added after the database columns (none of them links /legal).
    expect(links.map((a) => a.textContent)).toEqual([
      "All products",
      "Customer Service",
      "Blog",
      "Terms of Use",
      "Privacy Policy",
      "Returns and Refunds",
      "Shipping and Delivery",
      "Seller Agreement",
    ]);
    expect(links[2]).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("safeFooterUrl accepts internal paths and https only", () => {
    expect(safeFooterUrl("/stores")).toBe("/stores");
    expect(safeFooterUrl("//evil.com")).toBeNull();
    expect(safeFooterUrl("http://x.com")).toBeNull();
    expect(safeFooterUrl("https://x.com/a")).toBe("https://x.com/a");
    expect(safeFooterUrl("")).toBeNull();
  });
});

describe("siteService.getFooter", () => {
  it("reads site_settings and active footer_links", async () => {
    m().state.queue.push({ data: settings({ copyright_text: "© Saloree" }) }, { data: [] });
    const content = await siteService.getFooter();
    expect(content.copyright).toBe("© Saloree");
    expect(content.columns).toEqual([]);
    expect(m().callsOn("footer_links")).toContainEqual(["eq", "is_active", true]);
  });

  it("surfaces database errors as-is", async () => {
    m().state.queue.push({ error: { code: "PGRST205", message: "Could not find the table" } });
    await expect(siteService.getFooter()).rejects.toMatchObject({ code: "PGRST205" });
  });
});

describe("site footer: social media links (Instagram and TikTok)", () => {
  it("renders both links with exact default hrefs, rel, target, and aria-label", async () => {
    const { footer } = await renderFooter(toFooterContent(settings(), []));
    const social = within(footer).getByRole("list", { name: /social media/i });
    const links = within(social).getAllByRole("link");
    expect(links).toHaveLength(2);

    // Instagram
    expect(links[0]).toHaveAttribute("href", DEFAULT_INSTAGRAM_URL);
    expect(links[0]!.getAttribute("href")).toBe("https://www.instagram.com/saloreecom/");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(links[0]).toHaveAccessibleName(/Instagram/);
    expect(links[0]!.getAttribute("aria-label")).toMatch(/Instagram/);
    expect(links[0]!.textContent).toMatch(/opens in a new tab/i);

    // TikTok
    expect(links[1]).toHaveAttribute("href", DEFAULT_TIKTOK_URL);
    expect(links[1]!.getAttribute("href")).toBe("https://www.tiktok.com/@saloree.com");
    expect(links[1]!.getAttribute("href")).not.toContain("?lang=en");
    expect(links[1]).toHaveAttribute("target", "_blank");
    expect(links[1]).toHaveAttribute("rel", "noopener noreferrer");
    expect(links[1]).toHaveAccessibleName(/TikTok/);
    expect(links[1]!.getAttribute("aria-label")).toMatch(/TikTok/);
    expect(links[1]!.textContent).toMatch(/opens in a new tab/i);

    // Heading exists
    expect(within(footer).getByRole("heading", { name: /Follow Saloree/i })).toBeTruthy();
  });

  it("falls back to default URLs when fields are empty", async () => {
    const content = toFooterContent(
      settings({
        footer_settings: {
          instagram_url: "",
          tiktok_url: "   ",
        },
      }),
      [],
    );
    const { footer } = await renderFooter(content);
    const social = within(footer).getByRole("list", { name: /social media/i });
    const links = within(social).getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", DEFAULT_INSTAGRAM_URL);
    expect(links[1]).toHaveAttribute("href", DEFAULT_TIKTOK_URL);
  });

  it("is hidden when explicitly hidden with 'hide'", async () => {
    // Hide Instagram only
    const hideIg = toFooterContent(settings({ footer_settings: { instagram_url: "hide" } }), []);
    const view1 = await renderFooter(hideIg);
    const social1 = within(view1.footer).getByRole("list", { name: /social media/i });
    const links1 = within(social1).getAllByRole("link");
    expect(links1).toHaveLength(1);
    expect(links1[0]).toHaveAttribute("href", DEFAULT_TIKTOK_URL);

    // Hide TikTok only
    const hideTt = toFooterContent(settings({ footer_settings: { tiktok_url: "hide" } }), []);
    const view2 = await renderFooter(hideTt);
    const social2 = within(view2.footer).getByRole("list", { name: /social media/i });
    const links2 = within(social2).getAllByRole("link");
    expect(links2).toHaveLength(1);
    expect(links2[0]).toHaveAttribute("href", DEFAULT_INSTAGRAM_URL);

    // Hide both
    const hideBoth = toFooterContent(
      settings({ footer_settings: { instagram_url: "hide", tiktok_url: "hide" } }),
      [],
    );
    const view3 = await renderFooter(hideBoth);
    expect(within(view3.footer).queryByRole("list", { name: /social media/i })).toBeNull();
    expect(within(view3.footer).queryByRole("heading", { name: /Follow Saloree/i })).toBeNull();
  });

  it("renders custom valid URLs when specified by owner", async () => {
    const content = toFooterContent(
      settings({
        footer_settings: {
          instagram_url: "https://www.instagram.com/custom_saloree/",
          tiktok_url: "https://tiktok.com/@custom_saloree",
        },
      }),
      [],
    );
    const { footer } = await renderFooter(content);
    const social = within(footer).getByRole("list", { name: /social media/i });
    const links = within(social).getAllByRole("link");
    expect(links[0]).toHaveAttribute("href", "https://www.instagram.com/custom_saloree/");
    expect(links[1]).toHaveAttribute("href", "https://tiktok.com/@custom_saloree");
  });

  it("drops unsafe or wrong-host URLs without crashing", async () => {
    const content = toFooterContent(
      settings({
        footer_settings: {
          instagram_url: "javascript:alert(1)",
          tiktok_url: "https://evil.com/not-tiktok",
        },
      }),
      [],
    );
    const { footer } = await renderFooter(content);
    expect(within(footer).queryByRole("list", { name: /social media/i })).toBeNull();
  });

  it("no external requests are made by the icons (inline SVG only)", async () => {
    const { footer } = await renderFooter(toFooterContent(settings(), []));
    const social = within(footer).getByRole("list", { name: /social media/i });
    const svgs = social.querySelectorAll("svg");
    expect(svgs.length).toBe(2);
    for (const svg of svgs) {
      expect(svg.querySelector("image")).toBeNull();
      expect(svg.innerHTML).not.toMatch(/https?:\/\//i);
      expect(svg.innerHTML).not.toMatch(/xlink:href/i);
    }
    expect(social.querySelectorAll("img").length).toBe(0);
  });
});

describe("companyDetailsSchema & admin footer_settings", () => {
  it("zod rejects non-https URLs, invalid protocols and other hosts", () => {
    expect(
      companyDetailsSchema.safeParse({ instagram_url: "http://instagram.com/saloree" }).success,
    ).toBe(false);
    expect(companyDetailsSchema.safeParse({ instagram_url: "javascript:alert(1)" }).success).toBe(
      false,
    );
    expect(
      companyDetailsSchema.safeParse({ instagram_url: "https://facebook.com/saloree" }).success,
    ).toBe(false);
    expect(
      companyDetailsSchema.safeParse({ instagram_url: "https://notinstagram.com/saloree" }).success,
    ).toBe(false);
    expect(
      companyDetailsSchema.safeParse({
        instagram_url: "https://www.instagram.com/" + "a".repeat(200),
      }).success,
    ).toBe(false);

    expect(
      companyDetailsSchema.safeParse({ tiktok_url: "http://tiktok.com/@saloree" }).success,
    ).toBe(false);
    expect(companyDetailsSchema.safeParse({ tiktok_url: "javascript:alert(1)" }).success).toBe(
      false,
    );
    expect(
      companyDetailsSchema.safeParse({ tiktok_url: "https://youtube.com/@saloree" }).success,
    ).toBe(false);
    expect(
      companyDetailsSchema.safeParse({ tiktok_url: "https://www.tiktok.com/" + "a".repeat(200) })
        .success,
    ).toBe(false);
  });

  it("zod accepts valid https URLs, empty values and 'hide'", () => {
    expect(
      companyDetailsSchema.safeParse({
        instagram_url: "https://www.instagram.com/saloreecom/",
        tiktok_url: "https://www.tiktok.com/@saloree.com",
      }).success,
    ).toBe(true);

    expect(
      companyDetailsSchema.safeParse({
        instagram_url: "https://instagram.com/saloreecom/",
        tiktok_url: "https://tiktok.com/@saloree.com",
      }).success,
    ).toBe(true);

    expect(
      companyDetailsSchema.safeParse({
        instagram_url: "hide",
        tiktok_url: "HIDE",
      }).success,
    ).toBe(true);

    expect(
      companyDetailsSchema.safeParse({
        instagram_url: "",
        tiktok_url: null,
      }).success,
    ).toBe(true);
  });

  it("admin fields save into footer_settings without touching the other footer settings", () => {
    const existing = {
      theme: "dark",
      legal_name: "Saloree LLC",
      business_id: "AF-1",
      custom_flag: true,
    };
    const parsed = companyDetailsSchema.parse({
      instagram_url: "https://www.instagram.com/saloreecom/",
      tiktok_url: "hide",
    });
    const merged = mergeCompanyDetails(existing, parsed);
    expect(merged).toEqual({
      theme: "dark",
      legal_name: "Saloree LLC",
      business_id: "AF-1",
      custom_flag: true,
      instagram_url: "https://www.instagram.com/saloreecom/",
      tiktok_url: "hide",
    });
  });
});

describe("i18n check for social keys", () => {
  it("followUs and opensInNewTab exist in all 10 locales", () => {
    const root = join(process.cwd(), "src/locales");
    const codes = ["ar", "de", "en", "es", "fi", "he", "ko", "pt", "zh-Hans", "zh-Hant"];
    for (const code of codes) {
      const footerJson = JSON.parse(
        readFileSync(join(root, code, "footer.json"), "utf8"),
      ) as Record<string, string>;
      expect(footerJson["followUs"], `${code} missing followUs`).toBeTruthy();
      expect(footerJson["opensInNewTab"], `${code} missing opensInNewTab`).toBeTruthy();
      expect(footerJson["socialLink"], `${code} missing socialLink`).toBeTruthy();
    }
  });
});
