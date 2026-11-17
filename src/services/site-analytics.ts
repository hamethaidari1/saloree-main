/**
 * Site-wide visitor analytics for staff (admin and content_admin; the
 * database refuses everyone else). Read-only: site_analytics_summary,
 * site_visits and site_live_now. Errors keep the database's own words.
 */
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { ShapeError } from "./seller-dashboard";
import { presetRange, rangeDays, type DayRange } from "./store-traffic";

export type { DayRange };

/** The summary covers at most 90 days, the visit list 7. */
export const MAX_SUMMARY_DAYS = 90;
export const MAX_VISITS_DAYS = 7;
export const VISITS_PAGE_SIZE = 50;

export type SitePreset = "today" | "7" | "30" | "90";
export const SITE_PRESETS: readonly SitePreset[] = ["today", "7", "30", "90"];
export const sitePresetRange = (p: SitePreset, now = new Date()) => presetRange(p, now);
export const presetDays = (p: SitePreset) => (p === "today" ? 1 : Number(p));
/** The Visits list only accepts ranges up to 7 days. */
export const visitsAllowed = (p: SitePreset) => presetDays(p) <= MAX_VISITS_DAYS;

// Numbers from Postgres can arrive as strings.
const num = z.coerce.number().nonnegative();
const count = z.coerce.number().int().nonnegative();
const optNum = z.preprocess((v) => (v === "" ? null : v), z.coerce.number().nullable()).nullish();
const text = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v == null || v === "" ? null : String(v)));
const list = <T extends z.ZodTypeAny>(item: T) =>
  z
    .array(item)
    .nullish()
    .transform((v) => v ?? []);

// ---------------------------------------------------------------------------
// Ranked lists ("top pages", "browsers"…): one label and its visits per row
// ---------------------------------------------------------------------------
export interface RankedRow {
  label: string;
  visits: number;
  /** Page views, when the database sends them for this list. */
  page_views: number | null;
  /** The other text fields of the row (e.g. a city's country, a store's name). */
  extra: Record<string, string>;
}

const COUNT_KEYS = ["visits", "visitors", "views", "count", "page_views"] as const;

/**
 * Turns any `[{ <label>: "…", visits: n, … }]` into RankedRows: the label is
 * the first of `labelKeys` the row has. Rows without one are dropped.
 */
export function rankedRows(raw: unknown, labelKeys: readonly string[]): RankedRow[] {
  if (!Array.isArray(raw)) return [];
  const out: RankedRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const labelKey = labelKeys.find((k) => row[k] != null && row[k] !== "");
    if (!labelKey) continue;
    const countKey = COUNT_KEYS.find((k) => Number.isFinite(Number(row[k])) && row[k] != null);
    const extra: Record<string, string> = {};
    for (const [k, v] of Object.entries(row))
      if (
        k !== labelKey &&
        (typeof v === "string" || typeof v === "number") &&
        !COUNT_KEYS.includes(k as never)
      )
        extra[k] = String(v);
    const pv = Number(row["page_views"]);
    out.push({
      label: String(row[labelKey]),
      visits: countKey ? Number(row[countKey]) : 0,
      page_views:
        countKey !== "page_views" && Number.isFinite(pv) && row["page_views"] != null ? pv : null,
      extra,
    });
  }
  return out;
}

/** The label fields each list may use. */
export const LIST_LABELS = {
  top_pages: ["path", "page"],
  entry_pages: ["path", "page"],
  sources: ["source_type", "source"],
  referrers: ["referrer_host", "host", "referrer"],
  campaigns: ["utm_campaign", "campaign"],
  countries: ["country"],
  cities: ["city"],
  devices: ["device"],
  browsers: ["browser"],
  systems: ["os", "system"],
  languages: ["lang", "language"],
  stores: ["store_id", "store", "store_name", "name"],
} as const;
export type ListName = keyof typeof LIST_LABELS;

const ranked = (name: ListName) => z.unknown().transform((v) => rankedRows(v, LIST_LABELS[name]));

export const siteSummarySchema = z.preprocess(
  (v) => (Array.isArray(v) && v.length === 1 ? v[0] : v),
  z.object({
    totals: z.object({
      visitors: count,
      page_views: count,
      avg_pages_per_visit: optNum,
      single_page_visits_percent: optNum,
    }),
    by_day: list(z.object({ day: z.string(), visitors: count, page_views: count })),
    top_pages: ranked("top_pages"),
    entry_pages: ranked("entry_pages"),
    sources: ranked("sources"),
    referrers: ranked("referrers"),
    campaigns: ranked("campaigns"),
    countries: ranked("countries"),
    cities: ranked("cities"),
    devices: ranked("devices"),
    browsers: ranked("browsers"),
    systems: ranked("systems"),
    languages: ranked("languages"),
    stores: ranked("stores"),
    reached: z
      .object({ product: count.default(0), cart: count.default(0), checkout: count.default(0) })
      .nullish()
      .transform((v) => v ?? { product: 0, cart: 0, checkout: 0 }),
  }),
);
export type SiteSummary = z.output<typeof siteSummarySchema>;

const journeyStep = z.object({ t: text, path: text, store: text });
export const siteVisitSchema = z.object({
  visit: z.union([z.string(), z.number()]).transform(String),
  day: text,
  first_seen: text,
  last_seen: text,
  pages: count.catch(0),
  country: text,
  region: text,
  city: text,
  device: text,
  browser: text,
  os: text,
  lang: text,
  source_type: text,
  referrer_host: text,
  utm_source: text,
  utm_medium: text,
  utm_campaign: text,
  journey: list(journeyStep),
});
export type SiteVisit = z.output<typeof siteVisitSchema>;

export const siteVisitsSchema = z.preprocess(
  (v) => (Array.isArray(v) && v.length === 1 ? v[0] : v),
  z.object({ total: count, visits: list(siteVisitSchema) }),
);
export type SiteVisits = z.output<typeof siteVisitsSchema>;

export const liveSchema = z.preprocess(
  (v) => (Array.isArray(v) && v.length === 1 ? v[0] : v),
  z.object({
    visitors_now: count,
    visitors: list(
      z.object({
        visit: z.union([z.string(), z.number()]).transform(String),
        last_seen: text,
        path: text,
        country: text,
        city: text,
        device: text,
        source_type: text,
        store: text,
      }),
    ),
  }),
);
export type LiveNow = z.output<typeof liveSchema>;

export const SOURCE_TYPES = [
  "direct",
  "search",
  "social",
  "email",
  "campaign",
  "referral",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export interface VisitsFilter {
  range: DayRange;
  country: string | null;
  source: SourceType | null;
  storeId: string | null;
  page: number;
}

function parse<T extends z.ZodTypeAny>(fn: string, schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new ShapeError(fn, r.error.issues);
  return r.data;
}

export const siteAnalyticsService = {
  summary: async (range: DayRange, storeId: string | null): Promise<SiteSummary> => {
    const { data, error } = await supabase.rpc("site_analytics_summary", {
      p_from: range.from,
      p_to: range.to,
      p_store_id: storeId,
    });
    if (error) throw error;
    return parse("site_analytics_summary", siteSummarySchema, data);
  },

  visits: async (f: VisitsFilter): Promise<SiteVisits> => {
    if (rangeDays(f.range) > MAX_VISITS_DAYS)
      throw new Error(`Visits can be listed for at most ${MAX_VISITS_DAYS} days.`);
    const { data, error } = await supabase.rpc("site_visits", {
      p_from: f.range.from,
      p_to: f.range.to,
      p_country: f.country,
      p_source: f.source,
      p_store_id: f.storeId,
      p_limit: VISITS_PAGE_SIZE,
      p_offset: Math.max(0, f.page) * VISITS_PAGE_SIZE,
    });
    if (error) throw error;
    return parse("site_visits", siteVisitsSchema, data);
  },

  live: async (): Promise<LiveNow> => {
    const { data, error } = await supabase.rpc("site_live_now");
    if (error) throw error;
    return parse("site_live_now", liveSchema, data);
  },
};

export const siteAnalyticsKeys = {
  all: ["staff", "site-analytics"] as const,
  summary: (r: DayRange, storeId: string | null) =>
    ["staff", "site-analytics", "summary", r.from, r.to, storeId ?? "all"] as const,
  visits: (f: VisitsFilter) =>
    [
      "staff",
      "site-analytics",
      "visits",
      f.range.from,
      f.range.to,
      f.country ?? "",
      f.source ?? "",
      f.storeId ?? "",
      f.page,
    ] as const,
  live: ["staff", "site-analytics", "live"] as const,
};

/** Live now: refreshed every 15 seconds while the tab is visible. */
export const LIVE_REFRESH_MS = 15_000;

// ---------------------------------------------------------------------------
// Display helpers (no translations here: they return keys or data)
// ---------------------------------------------------------------------------
export type PathKind = "home" | "cart" | "checkout" | "product" | "store" | "other";

/** What kind of page a path is: "/" Home, "/product/…" Product… */
export function pathKind(path: string): PathKind {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : path;
  if (p === "/") return "home";
  if (p === "/cart") return "cart";
  if (p === "/checkout" || p.startsWith("/checkout/")) return "checkout";
  if (p.startsWith("/product/")) return "product";
  if (p.startsWith("/store/")) return "store";
  return "other";
}

/** "Visit #abcd1234": the first 8 characters of the anonymous visit code. */
export const shortVisit = (visit: string) => visit.replace(/[^A-Za-z0-9]/g, "").slice(0, 8);

/** Share of a funnel step relative to the first step, 0 when the first is 0. */
export const stepPercent = (part: number, first: number) => (first > 0 ? (part / first) * 100 : 0);
