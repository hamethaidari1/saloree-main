import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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
import {
  EMPTY_FOOTER,
  safeFooterUrl,
  siteService,
  toFooterContent,
  type FooterContent,
} from "@/services/site";
import type { FooterLinkRow, SiteSettingsFooterRow } from "@/data/db";

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
  const footer = await screen.findByRole("contentinfo");
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
    // Pages we don't have yet are never linked.
    const text = footer.textContent ?? "";
    for (const missing of ["Contact", "Terms", "Privacy", "Returns", "Shipping", "About"])
      expect(text).not.toContain(missing);
  });

  it("has 4 headed columns, a Back to top button and no unverifiable claims", async () => {
    const { footer } = await renderFooter(EMPTY_FOOTER);
    expect(
      within(footer)
        .getAllByRole("heading", { level: 2 })
        .map((h) => h.textContent),
    ).toEqual(["Shop", "Sell on Saloree", "Your account", "Help and policies"]);
    expect(within(footer).getByRole("button", { name: /back to top/i })).toBeTruthy();
    expect(footer.textContent).not.toMatch(/SSL|guarantee|verified|visa|mastercard/i);
    expect(footer.textContent).toContain("cash on delivery");
  });

  it("uses '© <year> Saloree' and hides company details and social links when missing", async () => {
    const { footer } = await renderFooter(toFooterContent(settings(), []));
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
        facebook_url: "https://facebook.com/saloree",
        instagram_url: "javascript:alert(1)",
        twitter_url: "",
        footer_settings: {
          legal_name: "Saloree Trading LLC",
          business_id: "AF-123456",
          address: "Kabul, Afghanistan",
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
    expect(socialLinks).toHaveLength(1); // the javascript: and empty URLs are dropped
    expect(socialLinks[0]).toHaveAttribute("href", "https://facebook.com/saloree");
    expect(socialLinks[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(socialLinks[0]).toHaveAttribute("target", "_blank");
    expect(socialLinks[0]).toHaveAccessibleName(/Facebook/);
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
    expect(links.map((a) => a.textContent)).toEqual(["All products", "Customer Service", "Blog"]);
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
