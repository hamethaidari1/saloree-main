import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { ShapeError } from "./seller-dashboard";

// Numbers from Postgres can arrive as strings.
const count = z.coerce.number().int().nonnegative();
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const list = <T extends z.ZodTypeAny>(item: T) =>
  z
    .array(item)
    .nullish()
    .transform((v) => v ?? []);

export const trafficSummarySchema = z.object({
  totals: z.object({
    visitors: count,
    page_views: count,
    orders: count,
    orders_confirmed: count,
    // null = no visitors in the period (never coerced to 0).
    conversion_percent: z.coerce
      .number()
      .finite()
      .nonnegative()
      .nullish()
      .transform((v) => v ?? null),
  }),
  by_day: list(
    z.object({
      day: z.string().transform((d) => d.slice(0, 10)),
      visitors: count,
      page_views: count,
    }),
  ),
  by_country: list(
    z.object({
      country: z
        .string()
        .transform((c) => c.trim().toUpperCase())
        .transform((c) => (/^[A-Z]{2}$/.test(c) ? c : "XX")),
      visitors: count,
      page_views: count,
    }),
  ),
});
export type TrafficSummary = z.output<typeof trafficSummarySchema>;

/** At most 30 countries come back; the rest is not available. */
export const MAX_COUNTRIES = 30;
export const MAX_RANGE_DAYS = 366;

export type TrafficPreset = "today" | "7" | "30" | "90" | "custom";
export const TRAFFIC_PRESETS: readonly { id: TrafficPreset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7", label: "Last 7 days" },
  { id: "30", label: "Last 30 days" },
  { id: "90", label: "Last 90 days" },
  { id: "custom", label: "Custom" },
];

export interface DayRange {
  /** Inclusive UTC days, "YYYY-MM-DD". */
  from: string;
  to: string;
}

const DAY_MS = 86_400_000;
const toDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const parseDay = (d: string) => (DAY_RE.test(d) ? Date.parse(`${d}T00:00:00Z`) : NaN);

/** Today (UTC) back to n-1 days ago: "Last 7 days" includes today. */
export function presetRange(preset: Exclude<TrafficPreset, "custom">, now = new Date()): DayRange {
  const to = toDay(now.getTime());
  const days = preset === "today" ? 1 : Number(preset);
  return { from: toDay(Date.parse(`${to}T00:00:00Z`) - (days - 1) * DAY_MS), to };
}

/** Number of days in the range, both ends included. */
export const rangeDays = (r: DayRange) =>
  Math.round((parseDay(r.to) - parseDay(r.from)) / DAY_MS) + 1;

export type RangeCheck = { ok: true; range: DayRange } | { ok: false; message: string };

export function validateRange(from: string, to: string, now = new Date()): RangeCheck {
  const f = parseDay(from);
  const t = parseDay(to);
  if (Number.isNaN(f) || Number.isNaN(t) || toDay(f) !== from || toDay(t) !== to)
    return { ok: false, message: "Choose a start and an end date." };
  if (f > t) return { ok: false, message: "The start date must be on or before the end date." };
  if (to > toDay(now.getTime()))
    return { ok: false, message: "The end date can't be in the future." };
  if (rangeDays({ from, to }) > MAX_RANGE_DAYS)
    return { ok: false, message: `Choose at most ${MAX_RANGE_DAYS} days.` };
  return { ok: true, range: { from, to } };
}

export const storeTrafficService = {
  /** Owner or admin only (enforced by the database function). */
  summary: async (storeId: string, range: DayRange): Promise<TrafficSummary> => {
    const { data, error } = await supabase.rpc("store_traffic_summary", {
      p_store_id: storeId,
      p_from: range.from,
      p_to: range.to,
    });
    if (error) throw error;
    // Some PostgREST setups wrap a single JSON value in an array.
    const value: unknown = Array.isArray(data) && data.length === 1 ? data[0] : data;
    const parsed = trafficSummarySchema.safeParse(value);
    if (!parsed.success) throw new ShapeError("store_traffic_summary", parsed.error.issues);
    return parsed.data;
  },
};

// ---------------------------------------------------------------------------
// Display helpers (English: the seller area is English)
// ---------------------------------------------------------------------------
const pct = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

/** 2.456 → "2.5%"; null → "—". */
export const formatPercent = (v: number | null) => (v == null ? "—" : `${pct.format(v)}%`);

/** Share of visitors in percent (0 when there are none). */
export const sharePercent = (part: number, total: number) => (total > 0 ? (part / total) * 100 : 0);

/** "TR" → 🇹🇷; "XX" or anything else → "" (no flag). */
export function flagEmoji(code: string) {
  if (!/^[A-Z]{2}$/.test(code) || code === "XX") return "";
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

let regionNames: Intl.DisplayNames | null | undefined;
/** "TR" → "Türkiye" (English); "XX" → "Unknown". */
export function countryName(code: string) {
  if (code === "XX" || !/^[A-Z]{2}$/.test(code)) return "Unknown";
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      regionNames = null;
    }
  }
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}
