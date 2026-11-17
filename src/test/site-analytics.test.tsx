import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createSupabaseMock } from "./supabase-mock";
import { testQueryClient } from "./router-harness";
import { WithLocale } from "./i18n";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

import {
  cleanPath,
  firstLanguage,
  geoFromHeaders,
  isTrackedPath,
  pageviewBodySchema,
  parseUserAgent,
  referrerHost,
  siteVisitorHash,
  utmFrom,
} from "@/lib/pageview-core";
import { handlePageview, resetPageviewWarnings, type PageviewDeps } from "@/lib/pageview.server";
import { buildPageview, isCountedSiteViewer } from "@/lib/site-tracking";
import { isBot } from "@/lib/track-core";
import { adminService } from "@/services/admin";
import {
  pathKind,
  rankedRows,
  shortVisit,
  siteAnalyticsService,
  siteSummarySchema,
  visitsAllowed,
} from "@/services/site-analytics";
import { VisitorsPanel } from "@/components/staff/visitors-panel";

const m = () => mock.current!;
const IP = "203.0.113.77";
const SALT = "test-salt-not-a-secret";
const NOW = new Date("2026-11-17T23:30:00Z");
const STORE = "6f1c2b0a-4d3e-4f5a-9b8c-7d6e5f4a3b2c";
const UA = {
  chromeWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  crios:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1",
  ipad: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  androidPhone:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  samsung:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36",
  firefoxLinux: "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0",
  opera:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 OPR/115.0",
  chromebook:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
};

beforeEach(() => {
  m().reset();
  resetPageviewWarnings();
});
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// Pure parts
// ---------------------------------------------------------------------------
describe("user agent parser (families only)", () => {
  it.each([
    ["chromeWin", "desktop", "Chrome", "Windows"],
    ["edge", "desktop", "Edge", "Windows"],
    ["safariMac", "desktop", "Safari", "macOS"],
    ["iphone", "mobile", "Safari", "iOS"],
    ["crios", "mobile", "Chrome", "iOS"],
    ["ipad", "tablet", "Safari", "iOS"],
    ["androidPhone", "mobile", "Chrome", "Android"],
    ["androidTablet", "tablet", "Chrome", "Android"],
    ["samsung", "mobile", "Samsung Internet", "Android"],
    ["firefoxLinux", "desktop", "Firefox", "Linux"],
    ["opera", "desktop", "Opera", "Windows"],
    ["chromebook", "desktop", "Chrome", "ChromeOS"],
  ] as const)("%s → %s / %s / %s", (key, device, browser, os) => {
    expect(parseUserAgent(UA[key])).toEqual({ device, browser, os });
  });

  it("anything unknown is 'other'", () => {
    expect(parseUserAgent("SomeTV/1.0")).toEqual({
      device: "other",
      browser: "Other",
      os: "Other",
    });
  });
});

describe("bots", () => {
  it.each([
    "Googlebot/2.1",
    "Mozilla/5.0 (compatible; bingbot/2.0)",
    "facebookexternalhit/1.1",
    "Slackbot-LinkExpanding 1.0",
    "Mozilla/5.0 HeadlessChrome/131.0",
    "Chrome-Lighthouse",
    "UptimeRobot/2.0 monitor",
    "curl/8.4.0",
    "Wget/1.21",
    "AhrefsCrawler",
    "Yahoo! Slurp",
    "Baiduspider",
    "WhatsApp link preview",
    "",
  ])("%s is a bot", (ua) => expect(isBot(ua)).toBe(true));

  it("real browsers are not", () => {
    for (const ua of Object.values(UA)) expect(isBot(ua), ua).toBe(false);
  });
});

describe("paths, referrers and campaign tags", () => {
  it("cleans paths: no query string, hash or trailing slash", () => {
    expect(cleanPath("/product/abc?ref=mail&utm_source=x#reviews")).toBe("/product/abc");
    expect(cleanPath("/store/shop/")).toBe("/store/shop");
    expect(cleanPath("//cart")).toBe("/cart");
    expect(cleanPath("/")).toBe("/");
    expect(cleanPath("")).toBe("/");
    expect(cleanPath(`/${"a".repeat(400)}`)).toHaveLength(300);
  });

  it("never counts dashboards, the API or the seller's preview", () => {
    for (const p of [
      "/admin",
      "/admin/marketplace",
      "/admin?tab=x",
      "/seller",
      "/seller/orders",
      "/api/track",
      "/preview/store",
    ])
      expect(isTrackedPath(p), p).toBe(false);
    for (const p of ["/", "/cart", "/product/x", "/store/s", "/sellers", "/administration-guide"])
      expect(isTrackedPath(p), p).toBe(true);
  });

  it("referrer: host name only; same site is empty", () => {
    expect(referrerHost("https://www.google.com/search?q=secret", "saloree.com")).toBe(
      "google.com",
    );
    expect(referrerHost("https://l.instagram.com/?u=x", "saloree.com")).toBe("l.instagram.com");
    expect(referrerHost("https://saloree.com/cart", "saloree.com")).toBe("");
    expect(referrerHost("https://www.saloree.com/", "saloree.com")).toBe("");
    // A store's own site and the main site are the same site.
    expect(referrerHost("https://shop.saloree.com/", "saloree.com", "saloree.com")).toBe("");
    expect(referrerHost("https://a.saloree.com/", "b.saloree.com", "saloree.com")).toBe("");
    expect(referrerHost("", "saloree.com")).toBe("");
    expect(referrerHost("not a url", "saloree.com")).toBe("");
    expect(referrerHost("android-app://com.google.android.gm/", "saloree.com")).toBe("");
  });

  it("utm tags: only the three, trimmed, only when present", () => {
    expect(utmFrom("?utm_source=test&utm_medium=cpc&utm_campaign=x&email=a@b.c")).toEqual({
      utm_source: "test",
      utm_medium: "cpc",
      utm_campaign: "x",
    });
    expect(utmFrom("?utm_source=%20%20")).toEqual({});
    expect(utmFrom("")).toEqual({});
  });

  it("first Accept-Language tag, 2 to 5 characters", () => {
    expect(firstLanguage("de-DE,de;q=0.9,en;q=0.8")).toBe("de-DE");
    expect(firstLanguage("fi")).toBe("fi");
    expect(firstLanguage("zh-Hant-TW,zh;q=0.9")).toBe("zh");
    expect(firstLanguage("*")).toBeNull();
    expect(firstLanguage(null)).toBeNull();
  });

  it("location from the Vercel headers; the city is URL-decoded; missing → null", () => {
    expect(
      geoFromHeaders(
        new Headers({
          "x-vercel-ip-country": "fi",
          "x-vercel-ip-country-region": "18",
          "x-vercel-ip-city": "J%C3%A4rvenp%C3%A4%C3%A4",
        }),
      ),
    ).toEqual({ country: "FI", region: "18", city: "Järvenpää" });
    expect(geoFromHeaders(new Headers())).toEqual({ country: null, region: null, city: null });
    expect(geoFromHeaders(new Headers({ "x-vercel-ip-city": "%E0%A4%A" })).city).toBeNull();
  });

  it("the visitor code is sha256(salt|day|ip|ua) as hex", async () => {
    const code = await siteVisitorHash({
      salt: SALT,
      day: "2026-11-17",
      ip: IP,
      userAgent: UA.chromeWin,
    });
    const expected = createHash("sha256")
      .update([SALT, "2026-11-17", IP, UA.chromeWin].join("|"))
      .digest("hex");
    expect(code).toBe(expected);
    expect(code).toMatch(/^[0-9a-f]{64}$/);
    expect(code).not.toContain(IP);
    const tomorrow = await siteVisitorHash({
      salt: SALT,
      day: "2026-11-18",
      ip: IP,
      userAgent: UA.chromeWin,
    });
    expect(tomorrow).not.toBe(code);
  });
});

describe("request body (zod)", () => {
  it("accepts the documented fields only", () => {
    expect(pageviewBodySchema.safeParse({ path: "/", is_entry: true }).success).toBe(true);
    expect(
      pageviewBodySchema.safeParse({
        path: "/product/x",
        is_entry: true,
        referrer_host: "google.com",
        utm_source: "test",
        utm_medium: "cpc",
        utm_campaign: "x",
        store_id: STORE,
      }).success,
    ).toBe(true);
    for (const bad of [
      {},
      { path: "", is_entry: true },
      { path: "no-slash", is_entry: true },
      { path: `/${"a".repeat(300)}`, is_entry: true },
      { path: "/", is_entry: "yes" },
      { path: "/", is_entry: true, store_id: "nope" },
      { path: "/", is_entry: true, referrer_host: "https://google.com/search?q=x" },
      { path: "/", is_entry: true, email: "a@b.c" },
      { path: "/", is_entry: true, utm_source: "x".repeat(101) },
      null,
    ])
      expect(pageviewBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /api/pageview
// ---------------------------------------------------------------------------
function deps(patch: Partial<PageviewDeps> = {}) {
  const warnings: string[] = [];
  const record = vi.fn(async () => ({ error: null }));
  const d: PageviewDeps = {
    salt: () => SALT,
    now: () => NOW,
    record,
    warn: (w) => warnings.push(w),
    ...patch,
  };
  return { d, record: d.record as typeof record, warnings };
}

const request = (
  body: unknown = { path: "/product/x", is_entry: true },
  headers: Record<string, string> = {},
) =>
  new Request("https://saloree.com/api/pageview", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "user-agent": UA.iphone,
      "x-forwarded-for": `${IP}, 10.0.0.1`,
      "x-vercel-ip-country": "FI",
      "x-vercel-ip-country-region": "18",
      "x-vercel-ip-city": "Helsinki",
      "accept-language": "fi-FI,fi;q=0.9",
      ...headers,
    },
  });

describe("POST /api/pageview", () => {
  it("records one view with location, device families and the daily code", async () => {
    const { d, record } = deps();
    const res = await handlePageview(
      request({
        path: "/product/x",
        is_entry: true,
        referrer_host: "google.com",
        utm_source: "test",
        utm_medium: "cpc",
        utm_campaign: "x",
        store_id: STORE,
      }),
      d,
    );
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(record).toHaveBeenCalledWith({
      p_visitor: await siteVisitorHash({
        salt: SALT,
        day: "2026-11-17",
        ip: IP,
        userAgent: UA.iphone,
      }),
      p_path: "/product/x",
      p_entry: true,
      p_referrer_host: "google.com",
      p_utm_source: "test",
      p_utm_medium: "cpc",
      p_utm_campaign: "x",
      p_country: "FI",
      p_region: "18",
      p_city: "Helsinki",
      p_device: "mobile",
      p_browser: "Safari",
      p_os: "iOS",
      p_lang: "fi-FI",
      p_store_id: STORE,
    });
  });

  it("only the entry page carries the referrer and campaign tags", async () => {
    const { d, record } = deps();
    await handlePageview(
      request({ path: "/cart", is_entry: false, referrer_host: "x.com", utm_source: "y" }),
      d,
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        p_entry: false,
        p_referrer_host: null,
        p_utm_source: null,
        p_store_id: null,
      }),
    );
  });

  it("missing location headers are sent as null", async () => {
    const { d, record } = deps();
    await handlePageview(
      new Request("https://saloree.com/api/pageview", {
        method: "POST",
        body: JSON.stringify({ path: "/", is_entry: true }),
        headers: { "user-agent": UA.chromeWin, "x-real-ip": IP },
      }),
      d,
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ p_country: null, p_region: null, p_city: null, p_lang: null }),
    );
  });

  it("stores nothing for DNT, GPC, bots, dashboards and bad bodies (always 204)", async () => {
    const cases: [string, Request][] = [
      ["DNT", request(undefined, { dnt: "1" })],
      ["GPC", request(undefined, { "sec-gpc": "1" })],
      ["bot", request(undefined, { "user-agent": "Googlebot/2.1" })],
      ["facebook", request(undefined, { "user-agent": "facebookexternalhit/1.1" })],
      ["empty UA", request(undefined, { "user-agent": "" })],
      ["no IP", request(undefined, { "x-forwarded-for": "" })],
      ["admin path", request({ path: "/admin", is_entry: true })],
      ["seller path", request({ path: "/seller/orders", is_entry: false })],
      ["invalid JSON", request("{nope")],
      ["extra field", request({ path: "/", is_entry: true, user_id: "u" })],
      ["huge body", request({ path: "/", is_entry: true, utm_campaign: "x".repeat(5000) })],
      ["GET", new Request("https://saloree.com/api/pageview", { method: "GET" })],
    ];
    for (const [name, req] of cases) {
      const { d, record } = deps();
      const res = await handlePageview(req, d);
      expect(res.status, name).toBe(204);
      expect(record, name).not.toHaveBeenCalled();
    }
  });

  it("without TRACK_SALT records nothing and warns once", async () => {
    const { d, record, warnings } = deps({ salt: () => undefined });
    await handlePageview(request(), d);
    await handlePageview(request(), d);
    expect(record).not.toHaveBeenCalled();
    expect(warnings).toEqual([
      "Site visitors are not recorded: the TRACK_SALT environment variable is not set.",
    ]);
  });

  it("database errors and crashes are swallowed, never logging the IP, browser or code", async () => {
    const failing = deps({
      record: async () => ({ error: { code: "PGRST202", message: "no function" } }),
    });
    expect((await handlePageview(request(), failing.d)).status).toBe(204);
    const throwing = deps({
      record: () => {
        throw new TypeError(`${IP} ${UA.iphone}`);
      },
    });
    expect((await handlePageview(request(), throwing.d)).status).toBe(204);
    const code = await siteVisitorHash({
      salt: SALT,
      day: "2026-11-17",
      ip: IP,
      userAgent: UA.iphone,
    });
    for (const line of [...failing.warnings, ...throwing.warnings]) {
      expect(line).not.toContain(IP);
      expect(line).not.toContain("Mozilla");
      expect(line).not.toContain(code);
    }
    expect(failing.warnings[0]).toContain("PGRST202");
    expect(throwing.warnings).toEqual(["A site visit could not be recorded (TypeError)."]);
  });
});

// ---------------------------------------------------------------------------
// Browser payload
// ---------------------------------------------------------------------------
describe("browser tracker payload", () => {
  const base = {
    pathname: "/product/x",
    search: "?utm_source=test&utm_medium=cpc&utm_campaign=x",
    referrer: "https://www.google.com/search?q=private",
    host: "saloree.com",
    rootDomain: "saloree.com",
    storeId: null,
  };

  it("the entry page sends the referrer host and utm tags", () => {
    expect(buildPageview({ ...base, isEntry: true })).toEqual({
      path: "/product/x",
      is_entry: true,
      referrer_host: "google.com",
      utm_source: "test",
      utm_medium: "cpc",
      utm_campaign: "x",
    });
  });

  it("later pages send only the path (and the store)", () => {
    expect(buildPageview({ ...base, isEntry: false, storeId: STORE })).toEqual({
      path: "/product/x",
      is_entry: false,
      store_id: STORE,
    });
  });

  it("no payload for dashboards; staff are not counted", () => {
    expect(buildPageview({ ...base, pathname: "/admin", isEntry: true })).toBeNull();
    expect(buildPageview({ ...base, pathname: "/seller/products", isEntry: false })).toBeNull();
    expect(isCountedSiteViewer([])).toBe(true);
    expect(isCountedSiteViewer(["customer"])).toBe(true);
    for (const r of ["admin", "content_admin", "finance_admin"])
      expect(isCountedSiteViewer([r])).toBe(false);
  });

  it("every payload passes the server's schema", () => {
    for (const isEntry of [true, false])
      expect(
        pageviewBodySchema.safeParse(buildPageview({ ...base, isEntry, storeId: STORE })).success,
      ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
const summary = (patch: Record<string, unknown> = {}) => ({
  totals: {
    visitors: 12,
    page_views: 40,
    avg_pages_per_visit: 3.33,
    single_page_visits_percent: 25,
  },
  by_day: [
    { day: "2026-11-16", visitors: 5, page_views: 15 },
    { day: "2026-11-17", visitors: 7, page_views: 25 },
  ],
  top_pages: [
    { path: "/", visits: 9 },
    { path: "/product/abc", visits: 4 },
  ],
  entry_pages: [{ path: "/", visits: 8 }],
  sources: [
    { source_type: "search", visits: 6 },
    { source_type: "direct", visits: 4 },
  ],
  referrers: [{ referrer_host: "google.com", visits: 6 }],
  campaigns: [{ utm_campaign: "x", utm_source: "test", utm_medium: "cpc", visits: 2 }],
  countries: [
    { country: "FI", visits: 7 },
    { country: "XX", visits: 1 },
  ],
  cities: [{ city: "Helsinki", country: "FI", visits: 5 }],
  devices: [{ device: "mobile", visits: 8 }],
  browsers: [{ browser: "Safari", visits: 8 }],
  systems: [{ os: "iOS", visits: 8 }],
  languages: [{ lang: "fi", visits: 7 }],
  stores: [{ store_id: STORE, visits: 3 }],
  reached: { product: 10, cart: 4, checkout: 1 },
  ...patch,
});

describe("site analytics service", () => {
  it("summary: passes range and store, parses the lists", async () => {
    m().state.queue.push({ data: summary() });
    const s = await siteAnalyticsService.summary({ from: "2026-11-11", to: "2026-11-17" }, STORE);
    expect(m().state.rpcs).toEqual([
      {
        fn: "site_analytics_summary",
        args: { p_from: "2026-11-11", p_to: "2026-11-17", p_store_id: STORE },
      },
    ]);
    expect(s.top_pages[0]).toMatchObject({ label: "/", visits: 9 });
    expect(s.cities[0]).toMatchObject({ label: "Helsinki", extra: { country: "FI" } });
    expect(s.reached).toEqual({ product: 10, cart: 4, checkout: 1 });
  });

  it("summary: missing lists are empty, a wrong shape is a clear error", () => {
    expect(siteSummarySchema.parse({ totals: { visitors: 0, page_views: 0 } }).sources).toEqual([]);
    expect(siteSummarySchema.safeParse({}).success).toBe(false);
  });

  it("visits: 50 per page, filters, at most 7 days", async () => {
    m().state.queue.push({ data: { total: 0, visits: [] } });
    await siteAnalyticsService.visits({
      range: { from: "2026-11-11", to: "2026-11-17" },
      country: "FI",
      source: "search",
      storeId: null,
      page: 2,
    });
    expect(m().state.rpcs).toEqual([
      {
        fn: "site_visits",
        args: {
          p_from: "2026-11-11",
          p_to: "2026-11-17",
          p_country: "FI",
          p_source: "search",
          p_store_id: null,
          p_limit: 50,
          p_offset: 100,
        },
      },
    ]);
    await expect(
      siteAnalyticsService.visits({
        range: { from: "2026-11-01", to: "2026-11-17" },
        country: null,
        source: null,
        storeId: null,
        page: 0,
      }),
    ).rejects.toThrow(/at most 7 days/);
    expect(visitsAllowed("7")).toBe(true);
    expect(visitsAllowed("30")).toBe(false);
  });

  it("the database's own error comes through", async () => {
    m().state.queue.push({
      error: { message: "permission denied for function site_live_now", code: "42501" },
    });
    await expect(siteAnalyticsService.live()).rejects.toMatchObject({ code: "42501" });
  });

  it("helpers: ranked rows, page kinds, short visit code", () => {
    expect(
      rankedRows([{ browser: "Firefox", visitors: "3" }, { visits: 1 }, null], ["browser"]),
    ).toEqual([{ label: "Firefox", visits: 3, page_views: null, extra: {} }]);
    expect(pathKind("/")).toBe("home");
    expect(pathKind("/cart")).toBe("cart");
    expect(pathKind("/checkout")).toBe("checkout");
    expect(pathKind("/product/a")).toBe("product");
    expect(pathKind("/store/s")).toBe("store");
    expect(pathKind("/legal/privacy")).toBe("other");
    expect(shortVisit("abcd1234ef567890")).toBe("abcd1234");
  });
});

// ---------------------------------------------------------------------------
// The admin screen
// ---------------------------------------------------------------------------
function show() {
  vi.spyOn(adminService, "listStores").mockResolvedValue([
    { id: STORE, name: "Nordic Goods" } as Awaited<
      ReturnType<typeof adminService.listStores>
    >[number],
  ]);
  return render(
    <WithLocale>
      <QueryClientProvider client={testQueryClient()}>
        <VisitorsPanel />
      </QueryClientProvider>
    </WithLocale>,
  );
}

describe("Visitors screen", () => {
  it("cards, live visitors, lists, funnel and the privacy note", async () => {
    vi.spyOn(siteAnalyticsService, "summary").mockResolvedValue(siteSummarySchema.parse(summary()));
    const live = vi.spyOn(siteAnalyticsService, "live").mockResolvedValue({
      visitors_now: 2,
      visitors: [
        {
          visit: "v1",
          last_seen: null,
          path: "/product/abc",
          country: "FI",
          city: "Helsinki",
          device: "mobile",
          source_type: "search",
          store: STORE,
        },
      ],
    });
    show();
    expect(screen.getByTestId("visitors-privacy")).toHaveTextContent(
      "Visitors are anonymous. The code changes every day. No names, e-mails or IP addresses are stored. Data is kept 90 days.",
    );
    expect(await screen.findByText("Pages per visit")).toBeInTheDocument();
    expect(screen.getByText("3.3")).toBeInTheDocument();
    expect(screen.getByText("25%")).toBeInTheDocument();
    const liveCard = await screen.findByTestId("visitors-live");
    expect(
      await within(liveCard).findByText("Visitors in the last 5 minutes: 2"),
    ).toBeInTheDocument();
    expect(within(liveCard).getByText("Product")).toBeInTheDocument();
    expect(within(liveCard).getByText(/Nordic Goods/)).toBeInTheDocument();
    expect(live).toHaveBeenCalled();
    const countries = screen.getByTestId("visitors-list-countries");
    expect(within(countries).getByText("Finland")).toBeInTheDocument();
    expect(within(countries).getByText("Unknown")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("visitors-list-sources")).getByText("Search"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("visitors-list-top_pages")).getByText("Home"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("visitors-list-stores")).getByText("Nordic Goods"),
    ).toBeInTheDocument();
    expect(within(screen.getByTestId("visitors-funnel")).getByText("40%")).toBeInTheDocument();
  });

  it("empty period", async () => {
    vi.spyOn(siteAnalyticsService, "summary").mockResolvedValue(
      siteSummarySchema.parse({ totals: { visitors: 0, page_views: 0 } }),
    );
    vi.spyOn(siteAnalyticsService, "live").mockResolvedValue({ visitors_now: 0, visitors: [] });
    show();
    expect(await screen.findByText("No visits yet in this period")).toBeInTheDocument();
    expect(await screen.findByText("Nobody is on the site right now.")).toBeInTheDocument();
  });

  it("errors show the database's words and retry", async () => {
    const s = vi.spyOn(siteAnalyticsService, "summary").mockRejectedValue({
      message: "permission denied for function site_analytics_summary",
      code: "42501",
    });
    vi.spyOn(siteAnalyticsService, "live").mockResolvedValue({ visitors_now: 0, visitors: [] });
    show();
    const alert = await screen.findByText(
      /permission denied for function site_analytics_summary \(42501\)/,
    );
    expect(alert).toBeInTheDocument();
    fireEvent.click(
      within(alert.closest("[role=alert]") as HTMLElement).getByRole("button", {
        name: "Try again",
      }),
    );
    await waitFor(() => expect(s).toHaveBeenCalledTimes(2));
  });

  it("the store filter is passed to the summary", async () => {
    const s = vi
      .spyOn(siteAnalyticsService, "summary")
      .mockResolvedValue(siteSummarySchema.parse(summary()));
    vi.spyOn(siteAnalyticsService, "live").mockResolvedValue({ visitors_now: 0, visitors: [] });
    show();
    const select = screen.getByRole("combobox", { name: "Store" });
    await within(select).findByRole("option", { name: "Nordic Goods" });
    fireEvent.change(select, { target: { value: STORE } });
    await waitFor(() => expect(s).toHaveBeenLastCalledWith(expect.anything(), STORE));
  });

  it("Visits tab: longer ranges are disabled, rows expand into the journey, pages of 50", async () => {
    vi.spyOn(siteAnalyticsService, "summary").mockResolvedValue(siteSummarySchema.parse(summary()));
    vi.spyOn(siteAnalyticsService, "live").mockResolvedValue({ visitors_now: 0, visitors: [] });
    const visits = vi.spyOn(siteAnalyticsService, "visits").mockResolvedValue({
      total: 120,
      visits: [
        {
          visit: "abcd1234ffff",
          day: "2026-11-17",
          first_seen: "2026-11-17T10:00:00Z",
          last_seen: "2026-11-17T10:05:00Z",
          pages: 3,
          country: "FI",
          region: "18",
          city: "Helsinki",
          device: "mobile",
          browser: "Safari",
          os: "iOS",
          lang: "fi",
          source_type: "campaign",
          referrer_host: "google.com",
          utm_source: "test",
          utm_medium: "cpc",
          utm_campaign: "x",
          journey: [
            { t: "2026-11-17T10:00:00Z", path: "/", store: null },
            { t: "2026-11-17T10:02:00Z", path: "/product/abc", store: STORE },
            { t: "2026-11-17T10:05:00Z", path: "/cart", store: null },
          ],
        },
      ],
    });
    show();
    fireEvent.click(screen.getByRole("radio", { name: "30 days" }));
    fireEvent.click(screen.getByRole("tab", { name: "Visits" }));
    // 30 days isn't allowed for the list: back to 7 days, and 30/90 are disabled.
    expect(screen.getByRole("radio", { name: "7 days" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "30 days" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "90 days" })).toBeDisabled();
    expect(screen.getByText(/covers at most 7 days/)).toBeInTheDocument();

    const row = await screen.findByTestId("visit-row");
    expect(row).toHaveTextContent("Visit #abcd1234");
    expect(row).toHaveTextContent("Helsinki, Finland");
    expect(row).toHaveTextContent("Mobile / Safari / iOS");
    expect(row).toHaveTextContent("Campaign · google.com");
    expect(row).toHaveTextContent("Pages: 3");
    fireEvent.click(within(row).getByRole("button", { name: "Show the journey" }));
    const journey = within(row).getByRole("list", { name: "Journey" });
    expect(within(journey).getAllByRole("listitem")).toHaveLength(3);
    expect(journey).toHaveTextContent("Nordic Goods");
    expect(journey).toHaveTextContent("Cart");

    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(visits).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 })),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Source" }), {
      target: { value: "search" },
    });
    await waitFor(() =>
      expect(visits).toHaveBeenLastCalledWith(
        expect.objectContaining({ source: "search", page: 0 }),
      ),
    );
  });

  it("is translated (German)", async () => {
    vi.spyOn(siteAnalyticsService, "summary").mockResolvedValue(siteSummarySchema.parse(summary()));
    vi.spyOn(siteAnalyticsService, "live").mockResolvedValue({ visitors_now: 0, visitors: [] });
    vi.spyOn(adminService, "listStores").mockResolvedValue([]);
    render(
      <WithLocale locale="de">
        <QueryClientProvider client={testQueryClient()}>
          <VisitorsPanel />
        </QueryClientProvider>
      </WithLocale>,
    );
    expect(screen.getByRole("heading", { name: "Besucher" })).toBeInTheDocument();
    expect(await screen.findByText("Finnland")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Source checks
// ---------------------------------------------------------------------------
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
describe("privacy by construction", () => {
  const files = [
    "src/lib/pageview-core.ts",
    "src/lib/pageview.server.ts",
    "src/lib/site-tracking.ts",
    "src/components/marketplace/site-tracker.tsx",
    "src/routes/api.pageview.ts",
  ];

  it("no cookies, browser storage or fingerprinting; no service-role key; salt server-only", () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(
        /document\.cookie|localStorage|sessionStorage|indexedDB|\bcanvas\b|getContext\(|navigator\.(plugins|hardwareConcurrency|deviceMemory)|screen\.(width|height)/,
      );
      expect(src, f).not.toMatch(/service_role|SERVICE_ROLE|VITE_TRACK_SALT/i);
      expect(src, f).not.toMatch(/console\.(log|info|debug)/);
    }
  });

  it("the route, the root mount and both staff panels", () => {
    expect(read("src/routes/api.pageview.ts")).toMatch(
      /POST: \(\{ request \}\) => handlePageview\(request\)/,
    );
    expect(read("src/routes/__root.tsx")).toContain("<SiteTracker />");
    for (const f of ["src/routes/admin.tsx", "src/routes/admin_.marketplace.tsx"]) {
      expect(read(f), f).toContain('["visitors", "Visitors"]');
      expect(read(f), f).toContain("<VisitorsPanel />");
    }
    expect(read("src/routes/admin_.finance.tsx")).not.toContain("VisitorsPanel");
  });
});
