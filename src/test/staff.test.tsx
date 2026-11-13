import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createSupabaseMock } from "./supabase-mock";
import { renderWithRouter } from "./router-harness";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

import {
  canOpenPanel,
  decidePanelAccess,
  isStaff,
  panelsFor,
  staffHome,
  STAFF_PANELS,
} from "@/lib/staff-access";
import { homeForRoles } from "@/lib/redirects";
import { requirePanel } from "@/lib/auth";
import {
  CONTENT_SCHEMAS,
  groupSellers,
  marketplaceService,
  SITE_TEXT_FIELDS,
  siteTextsSchema,
} from "@/services/marketplace";
import {
  companyDetailsSchema,
  EMPTY_ORDER_FILTER,
  filterFinanceOrders,
  financeService,
  mergeCompanyDetails,
  parseFinanceOverview,
  type FinanceOrder,
} from "@/services/finance";
import { groupStaff, NotRegisteredError, teamService } from "@/services/team";
import { auditService, dayRange, describeChanges, formatValue } from "@/services/audit";
import { toFooterContent } from "@/services/site";
import type { AdminStore } from "@/services/admin";
import { NoAccess, PanelSwitcher } from "@/components/staff/staff-shell";
import { FinanceOrdersPanel } from "@/components/staff/finance-panels";
import { TeamPanel } from "@/components/staff/team-panels";

const m = () => mock.current!;
beforeEach(() => m().reset());

const withQuery = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);

// ---------------------------------------------------------------------------
// Roles → routes
// ---------------------------------------------------------------------------
describe("staff access rules", () => {
  it.each([
    [["admin"], ["admin", "marketplace", "finance"]],
    [["content_admin"], ["marketplace"]],
    [["finance_admin"], ["finance"]],
    [
      ["content_admin", "finance_admin"],
      ["marketplace", "finance"],
    ],
    [["seller", "customer"], []],
    [[], []],
  ])("%j can open %j", (roles, panels) => {
    expect(panelsFor(roles).map((p) => p.id)).toEqual(panels);
    for (const p of STAFF_PANELS)
      expect(canOpenPanel(p.id, roles), p.id).toBe(panels.includes(p.id));
  });

  it("everyone lands on their own panel; admin first", () => {
    expect(staffHome(["admin", "finance_admin"])).toBe("/admin");
    expect(staffHome(["content_admin"])).toBe("/admin/marketplace");
    expect(staffHome(["finance_admin", "seller"])).toBe("/admin/finance");
    expect(staffHome(["content_admin", "finance_admin"])).toBe("/admin/marketplace");
    expect(staffHome(["seller"])).toBeNull();
    expect(homeForRoles(["finance_admin"])).toBe("/admin/finance");
    expect(homeForRoles(["seller"])).toBe("/seller");
    expect(homeForRoles([])).toBe("/account");
    expect(isStaff(["customer", "content_admin"])).toBe(true);
    expect(isStaff(["seller"])).toBe(false);
  });

  it("guard decision: signed out → login; wrong role → forbidden", () => {
    expect(decidePanelAccess(false, ["admin"], "admin")).toBe("login");
    expect(decidePanelAccess(true, ["content_admin"], "finance")).toBe("forbidden");
    expect(decidePanelAccess(true, ["content_admin"], "admin")).toBe("forbidden");
    expect(decidePanelAccess(true, ["finance_admin"], "marketplace")).toBe("forbidden");
    expect(decidePanelAccess(true, ["finance_admin"], "finance")).toBe("allowed");
    expect(decidePanelAccess(true, ["admin"], "marketplace")).toBe("allowed");
  });
});

describe("requirePanel route guard", () => {
  const ctx = { location: { href: "/admin/finance?tab=orders" } };
  it("signed out → redirect to /login and back", async () => {
    m().state.session = null;
    await expect(requirePanel("finance")(ctx)).rejects.toMatchObject({
      options: { to: "/login", search: { redirect: "/admin/finance?tab=orders" } },
    });
  });
  it("Fazil (content_admin) on /admin/finance → allowed: false (no-access page)", async () => {
    m().state.queue.push({ data: [{ role: "content_admin" }] });
    const r = await requirePanel("finance")(ctx);
    expect(r.allowed).toBe(false);
    expect(m().callsOn("user_roles")).toContainEqual(["eq", "user_id", "user-1"]);
  });
  it("Omar (finance_admin) on /admin/marketplace → no access; on finance → allowed", async () => {
    m().state.queue.push({ data: [{ role: "finance_admin" }] });
    expect((await requirePanel("marketplace")(ctx)).allowed).toBe(false);
    m().state.queue.push({ data: [{ role: "finance_admin" }] });
    expect((await requirePanel("finance")(ctx)).allowed).toBe(true);
  });
  it("roles that can't be read → error, never access (fail closed)", async () => {
    m().state.queue.push({ error: { code: "42501", message: "permission denied" } });
    await expect(requirePanel("admin")(ctx)).rejects.toMatchObject({ code: "42501" });
  });
});

describe("no-access page and panel switcher", () => {
  it("explains the missing role and links to the person's own panel", async () => {
    renderWithRouter(<NoAccess panel="finance" roles={["content_admin"]} />);
    expect(await screen.findByRole("heading", { name: "You don't have access" })).toBeTruthy();
    expect(screen.getByText(/finance admin or admin role/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to your panel" })).toHaveAttribute(
      "href",
      "/admin/marketplace",
    );
  });
  it("switcher only for people with several panels", async () => {
    const { unmount } = renderWithRouter(
      <>
        <p>rendered</p>
        <PanelSwitcher current="finance" roles={["finance_admin"]} />
      </>,
    );
    await screen.findByText("rendered");
    expect(screen.queryByRole("navigation", { name: "Staff panels" })).toBeNull();
    unmount();
    renderWithRouter(
      <PanelSwitcher current="finance" roles={["content_admin", "finance_admin"]} />,
    );
    const nav = await screen.findByRole("navigation", { name: "Staff panels" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Marketplace", "Finance"]);
    expect(links[1]).toHaveAttribute("aria-current", "page");
  });
});

// ---------------------------------------------------------------------------
// Fazil
// ---------------------------------------------------------------------------
const store = (patch: Partial<AdminStore>): AdminStore =>
  ({
    id: "s1",
    owner_id: "o1",
    name: "Alpha",
    slug: "alpha",
    status: "draft",
    ownerEmail: "a@x.io",
    ownerName: "Ana",
    productCount: 2,
    ...patch,
  }) as AdminStore;

describe("marketplace service (content_admin)", () => {
  it("overview counts come from real queries", async () => {
    m().state.queue.push(
      { count: 3 },
      { count: 5 },
      { count: 40 },
      { count: 7 },
      { count: 8 },
      {
        data: [{ owner_id: "a" }, { owner_id: "b" }, { owner_id: "a" }],
      },
    );
    expect(await marketplaceService.getOverview()).toEqual({
      storesWaiting: 3,
      storesPublished: 5,
      productsActive: 40,
      productsDraft: 7,
      categories: 8,
      sellers: 2,
    });
    expect(m().callsOn("stores", 0)).toContainEqual(["eq", "status", "draft"]);
  });

  it("groups store owners into sellers with their stores and product counts", () => {
    const sellers = groupSellers([
      store({ id: "s1", owner_id: "o1", productCount: 2 }),
      store({ id: "s2", owner_id: "o1", name: "Beta", status: "published", productCount: 3 }),
      store({ id: "s3", owner_id: "o2", ownerName: "Bo", ownerEmail: "b@x.io", productCount: 0 }),
    ]);
    expect(sellers.map((s) => [s.name, s.stores.length, s.productCount])).toEqual([
      ["Ana", 2, 5],
      ["Bo", 1, 0],
    ]);
  });

  it("content schemas validate links, images and order", () => {
    expect(
      CONTENT_SCHEMAS.footer_links.safeParse({
        category: "Help",
        label: "FAQ",
        url: "javascript:x",
        display_order: 1,
        is_active: true,
      }).success,
    ).toBe(false);
    expect(
      CONTENT_SCHEMAS.footer_links.parse({
        category: "Help",
        label: "FAQ",
        url: "/help",
        display_order: "2",
        is_active: true,
      }),
    ).toMatchObject({ url: "/help", display_order: 2 });
    expect(
      CONTENT_SCHEMAS.hero_slides.safeParse({
        image_url: "http://x.io/a.jpg",
        alt_text: "A room",
        display_order: 0,
        is_active: true,
      }).success,
    ).toBe(false);
    expect(
      CONTENT_SCHEMAS.homepage_sections.safeParse({
        section_key: "Bad Key",
        title: "",
        display_order: 0,
        is_visible: true,
      }).success,
    ).toBe(false);
    expect(
      CONTENT_SCHEMAS.promo_banners.parse({
        image_url: "",
        title: " Sale ",
        subtitle: "",
        button_text: "",
        button_link: "",
        display_order: 0,
        is_active: false,
      }),
    ).toMatchObject({ image_url: null, title: "Sale", button_link: null });
  });

  it("creates / updates / deletes content rows in the right table", async () => {
    await marketplaceService.createContent("footer_links", {
      category: "Help",
      label: "FAQ",
      url: "/help",
      display_order: 0,
      is_active: true,
    });
    expect(m().callsOn("footer_links")[0]).toEqual([
      "insert",
      { category: "Help", label: "FAQ", url: "/help", display_order: 0, is_active: true },
    ]);
    m().state.queue.push({ data: [{ id: "x" }] });
    await marketplaceService.updateContent("promo_banners", "x", {
      image_url: "",
      title: "T",
      subtitle: "",
      button_text: "",
      button_link: "",
      display_order: 1,
      is_active: true,
    });
    expect(m().callsOn("promo_banners")).toContainEqual(["eq", "id", "x"]);
    // RLS refusal shows up as 0 rows → error, never a silent success.
    await expect(marketplaceService.deleteContent("hero_slides", "y")).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("uploads images into the uploader's own folder and returns the public https URL", async () => {
    const url = await marketplaceService.uploadContentImage(
      new File(["x"], "Banner.PNG", { type: "image/png" }),
    );
    expect(m().state.uploads[0]).toMatchObject({ bucket: "store-banners" });
    expect(m().state.uploads[0]!.path).toMatch(/^user-1\/homepage\/[0-9a-f-]+\.png$/);
    expect(url).toMatch(/^https:\/\//);
    await expect(
      marketplaceService.uploadContentImage(new File(["x"], "a.pdf", { type: "application/pdf" })),
    ).rejects.toThrow(/image/);
  });

  it("site texts never read or send footer_settings (company details)", async () => {
    expect(SITE_TEXT_FIELDS).not.toContain("footer_settings");
    // The form always sends every field (blank = cleared).
    const blank = Object.fromEntries(SITE_TEXT_FIELDS.map((k) => [k, ""]));
    expect(siteTextsSchema.safeParse(blank).success).toBe(true);
    expect(
      siteTextsSchema.safeParse({ ...blank, footer_settings: { legal_name: "X" } }).success,
    ).toBe(false);
    m().state.queue.push({ data: { id: "row", footer_description: "Hi" } });
    await marketplaceService.getSiteTexts();
    const select = m()
      .callsOn("site_settings", 0)
      .find((c) => c[0] === "select")!;
    expect(String(select[1])).not.toMatch(/footer_settings/);
    m().state.queue.push({ data: [{ id: "row" }] });
    await marketplaceService.saveSiteTexts("row", {
      ...blank,
      footer_description: "Hello",
      facebook_url: "https://facebook.com/s",
    });
    const update = m()
      .callsOn("site_settings", 1)
      .find((c) => c[0] === "update")!;
    expect(update[1]).not.toHaveProperty("footer_settings");
    expect(update[1]).toMatchObject({
      footer_description: "Hello",
      facebook_url: "https://facebook.com/s",
    });
    expect(
      siteTextsSchema.safeParse({ ...blank, instagram_url: "http://insecure.com" }).success,
    ).toBe(false);
    expect(update[1]).toMatchObject({ hero_title: null, instagram_url: null });
  });
});

// ---------------------------------------------------------------------------
// Omar
// ---------------------------------------------------------------------------
const overview = {
  days: 30,
  orders_count: "4",
  gross_sales: "120.50",
  commission_total: "12.05",
  seller_payable: "108.45",
  discounts_given: "3",
  paid_amount: "0",
  cod_amount: "120.50",
  unpaid_online_amount: "0",
  cancelled_count: 1,
  by_day: [{ day: "2026-11-10", orders: 1, sales: "20", commission: "2" }],
  top_stores: [{ store_id: "s1", name: "Alpha", orders: 4, sales: "120.5", commission: "12.05" }],
  by_payment: [{ provider: "cod", payment_status: "pending", orders: 4, amount: "120.5" }],
};

describe("finance service (finance_admin)", () => {
  it("calls finance_overview with p_days and turns numeric strings into numbers", async () => {
    m().state.queue.push({ data: overview });
    const o = await financeService.overview(30);
    expect(m().state.rpcs).toEqual([{ fn: "finance_overview", args: { p_days: 30 } }]);
    expect(o).toMatchObject({ gross_sales: 120.5, orders_count: 4, cod_amount: 120.5 });
    expect(o.top_stores[0]).toEqual({
      store_id: "s1",
      name: "Alpha",
      orders: 4,
      sales: 120.5,
      commission: 12.05,
    });
  });
  it("accepts a one-row array and empty lists; names missing fields otherwise", () => {
    expect(
      parseFinanceOverview([{ ...overview, by_day: null, top_stores: null, by_payment: null }])
        .by_day,
    ).toEqual([]);
    expect(() => parseFinanceOverview({ days: 7 })).toThrow(
      /unexpected shape \(check: .*orders_count/,
    );
  });
  it("surfaces database errors as-is (e.g. function missing or not allowed)", async () => {
    m().state.queue.push({
      error: { code: "PGRST202", message: "Could not find the function public.finance_overview" },
    });
    await expect(financeService.overview(7)).rejects.toMatchObject({ code: "PGRST202" });
  });

  const order = (patch: Partial<FinanceOrder>): FinanceOrder =>
    ({
      id: "aaaa1111-0000-0000-0000-000000000000",
      store_id: "s1",
      status: "pending",
      payment_status: "pending",
      payment_provider: "cod",
      full_name: "Sara Ahmadi",
      phone: "+93 70 123 4567",
      created_at: "2026-11-10T10:00:00Z",
      stores: { name: "Alpha", slug: "alpha" },
      ...patch,
    }) as FinanceOrder;

  it("filters orders by status, payment, provider, store, dates and search", () => {
    const list = [
      order({}),
      order({
        id: "bbbb2222",
        status: "cancelled",
        payment_provider: "stripe",
        payment_status: "paid",
        store_id: "s2",
        full_name: "Amir",
        phone: null,
        created_at: "2026-11-12T10:00:00Z",
      }),
    ];
    const f = (p: Partial<typeof EMPTY_ORDER_FILTER>) =>
      filterFinanceOrders(list, { ...EMPTY_ORDER_FILTER, ...p }).map((o) => o.full_name);
    expect(f({ status: "cancelled" })).toEqual(["Amir"]);
    expect(f({ paymentStatus: "paid" })).toEqual(["Amir"]);
    expect(f({ provider: "cod" })).toEqual(["Sara Ahmadi"]);
    expect(f({ storeId: "s2" })).toEqual(["Amir"]);
    expect(f({ from: "2026-11-11" })).toEqual(["Amir"]);
    expect(f({ to: "2026-11-11" })).toEqual(["Sara Ahmadi"]);
    expect(f({ query: "123 45" })).toEqual(["Sara Ahmadi"]);
    expect(f({ query: "#bbbb" })).toEqual(["Amir"]);
  });

  it("orders are only ever read", async () => {
    await financeService.listOrders();
    await financeService.orderItems("o1");
    const all = m().state.queries.flatMap((q) => q.calls.map((c) => c[0]));
    expect(all).not.toContain("update");
    expect(all).not.toContain("delete");
    expect(all).not.toContain("insert");
  });

  it("commission change records who made it", async () => {
    m().state.queue.push({ data: [{ id: true }] });
    await financeService.setCommission("12.5");
    const update = m()
      .callsOn("platform_settings")
      .find((c) => c[0] === "update")!;
    expect(update[1]).toMatchObject({ commission_percent: 12.5, updated_by: "user-1" });
    await expect(financeService.setCommission("100.001")).rejects.toThrow();
  });

  it("company details: only the four keys change, other footer_settings keys are kept", () => {
    const values = companyDetailsSchema.parse({
      legal_name: " Saloree LLC ",
      business_id: "",
      address: "Kabul",
      support_email: "help@saloree.com",
    });
    expect(
      mergeCompanyDetails({ theme: "dark", business_id: "OLD", legal_name: "Old" }, values),
    ).toEqual({
      theme: "dark",
      legal_name: "Saloree LLC",
      address: "Kabul",
      support_email: "help@saloree.com",
    });
    expect(
      companyDetailsSchema.safeParse({
        legal_name: "",
        business_id: "",
        address: "",
        support_email: "nope",
      }).success,
    ).toBe(false);
    expect(
      companyDetailsSchema.safeParse({
        legal_name: "x".repeat(121),
        business_id: "",
        address: "",
        support_email: "",
      }).success,
    ).toBe(false);
  });

  it("saving company details writes ONLY footer_settings, merged with a fresh copy", async () => {
    m().state.queue.push(
      { data: { id: "row", footer_settings: { theme: "dark" } } },
      { data: [{ id: "row" }] },
    );
    await financeService.saveCompanyDetails({
      legal_name: "Saloree LLC",
      business_id: "AF-1",
      address: "",
      support_email: "",
    });
    const update = m()
      .callsOn("site_settings", 1)
      .find((c) => c[0] === "update")!;
    expect(Object.keys(update[1] as object)).toEqual(["footer_settings"]);
    expect(update[1]).toEqual({
      footer_settings: { theme: "dark", legal_name: "Saloree LLC", business_id: "AF-1" },
    });
  });

  it("the footer shows support_email only when it is a real email address", () => {
    const base = {
      footer_description: null,
      copyright_text: null,
      facebook_url: null,
      instagram_url: null,
      twitter_url: null,
    };
    expect(
      toFooterContent({ ...base, footer_settings: { support_email: "help@saloree.com" } }, [])
        .company.supportEmail,
    ).toBe("help@saloree.com");
    expect(
      toFooterContent({ ...base, footer_settings: { support_email: "javascript:alert(1)" } }, [])
        .company.supportEmail,
    ).toBeNull();
  });

  it("the Orders tab has no way to change an order", async () => {
    m().state.queue.push({ data: [order({})] });
    renderWithRouter(withQuery(<FinanceOrdersPanel />));
    await screen.findByText("Sara Ahmadi");
    const buttons = screen.getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual(["Clear", "#aaaa1111"]); // filters + open details only
    fireEvent.click(screen.getByRole("button", { name: "#aaaa1111" }));
    expect(
      await screen.findByText(/Read only\. Order status is changed by the store\./),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Hamed
// ---------------------------------------------------------------------------
describe("team service (admin)", () => {
  it("groups staff roles per person and ignores non-staff roles", () => {
    const team = groupStaff(
      [
        { user_id: "u1", role: "finance_admin", created_at: "2026-11-01" },
        { user_id: "u1", role: "admin", created_at: "2026-10-01" },
        { user_id: "u2", role: "seller", created_at: null },
      ],
      [{ id: "u1", full_name: "Hamed", email: "h@x.io" }],
    );
    expect(team).toEqual([
      {
        userId: "u1",
        name: "Hamed",
        email: "h@x.io",
        roles: [
          { role: "admin", since: "2026-10-01" },
          { role: "finance_admin", since: "2026-11-01" },
        ],
      },
    ]);
  });
  it("adding a role for someone not registered says they must register first", async () => {
    m().state.queue.push({ data: [] });
    await expect(
      teamService.addRole({ email: "new@x.io", role: "content_admin" }),
    ).rejects.toBeInstanceOf(NotRegisteredError);
    await expect(teamService.addRole({ email: "nope", role: "content_admin" })).rejects.toThrow();
  });
  it("finds the person by exact email (wildcards escaped) and inserts the role", async () => {
    m().state.queue.push(
      { data: [{ id: "u9", full_name: "Fazil", email: "Fazil@x.io" }] },
      { data: null },
    );
    await teamService.addRole({ email: "fazil@x.io", role: "content_admin" });
    expect(m().callsOn("profiles")).toContainEqual(["ilike", "email", "fazil@x.io"]);
    expect(m().callsOn("user_roles")[0]).toEqual([
      "insert",
      { user_id: "u9", role: "content_admin" },
    ]);
    m().state.queue.push({ data: [] });
    await teamService.findByEmail("a_b%c@x.io");
    expect(m().callsOn("profiles", 1)).toContainEqual(["ilike", "email", "a\\_b\\%c@x.io"]);
  });
  it("refuses removing your own admin role (the database refuses too)", async () => {
    await expect(teamService.removeRole("user-1", "admin")).rejects.toThrow(/own admin role/);
    m().state.queue.push({ data: [{ user_id: "u2" }] });
    await teamService.removeRole("u2", "finance_admin");
    expect(m().callsOn("user_roles")).toContainEqual(["eq", "role", "finance_admin"]);
  });
  it("the remove button for your own admin role is disabled", async () => {
    m().state.queue.push(
      {
        data: [
          { user_id: "user-1", role: "admin", created_at: "2026-10-01" },
          { user_id: "u2", role: "content_admin", created_at: "2026-11-01" },
        ],
      },
      {
        data: [
          { id: "user-1", full_name: "Hamed", email: "h@x.io" },
          { id: "u2", full_name: "Fazil", email: "f@x.io" },
        ],
      },
    );
    renderWithRouter(withQuery(<TeamPanel myUserId="user-1" />));
    expect(
      await screen.findByRole("button", { name: /Remove Admin \(everything\) from Hamed/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Remove Content admin \(marketplace\) from Fazil/ }),
    ).not.toBeDisabled();
  });
});

describe("audit log", () => {
  it("UPDATE shows before → after per column; INSERT/DELETE show the row", () => {
    expect(describeChanges("UPDATE", { status: { old: "draft", new: "published" } })).toEqual([
      { field: "status", before: "draft", after: "published" },
    ]);
    expect(describeChanges("INSERT", { role: "finance_admin" })).toEqual([
      { field: "role", before: "—", after: "finance_admin" },
    ]);
    expect(describeChanges("DELETE", { role: "admin" })).toEqual([
      { field: "role", before: "admin", after: "—" },
    ]);
    expect(describeChanges("UPDATE", null)).toEqual([]);
  });
  it("long values are truncated; objects shown as JSON; null as empty", () => {
    expect(formatValue("x".repeat(200))).toHaveLength(80);
    expect(formatValue("x".repeat(200)).endsWith("…")).toBe(true);
    expect(formatValue({ a: 1 })).toBe('{"a":1}');
    expect(formatValue(null)).toBe("empty");
  });
  it("date range covers whole local days", () => {
    const r = dayRange("2026-11-01", "2026-11-02");
    expect(new Date(r.lt!).getTime() - new Date(r.gte!).getTime()).toBe(2 * 86_400_000);
    expect(dayRange("", "")).toEqual({});
  });
  it("lists newest first, 50 per page, with filters and actor names", async () => {
    m().state.queue.push(
      {
        data: [
          {
            id: 9,
            actor_id: "u2",
            actor_roles: ["content_admin"],
            table_name: "stores",
            row_id: "s1",
            action: "UPDATE",
            changes: {},
            created_at: "2026-11-12T10:00:00Z",
          },
        ],
        count: 51,
      },
      { data: [{ id: "u2", full_name: "Fazil", email: "f@x.io" }] },
    );
    const res = await auditService.list(1, {
      actorId: "u2",
      table: "stores",
      from: "2026-11-01",
      to: "",
    });
    expect(res.total).toBe(51);
    expect(res.rows[0]!.actor).toEqual({ name: "Fazil", email: "f@x.io" });
    const calls = m().callsOn("audit_log");
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(calls).toContainEqual(["range", 50, 99]);
    expect(calls).toContainEqual(["eq", "actor_id", "u2"]);
    expect(calls).toContainEqual(["eq", "table_name", "stores"]);
    expect(calls.some((c) => c[0] === "gte")).toBe(true);
  });
});
