import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createSupabaseMock } from "./supabase-mock";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

import {
  countryName,
  flagEmoji,
  formatPercent,
  presetRange,
  rangeDays,
  sharePercent,
  storeTrafficService,
  trafficSummarySchema,
  validateRange,
} from "@/services/store-traffic";
import { CountriesTable, TrafficChart, TrafficSection } from "@/components/seller/traffic";

const m = () => mock.current!;
beforeEach(() => m().reset());

const STORE = { id: "6f1c2b0a-4d3e-4f5a-9b8c-7d6e5f4a3b2c", slug: "beta", status: "published" };

const summary = {
  totals: {
    visitors: 40,
    page_views: "130",
    orders: 3,
    orders_confirmed: 2,
    conversion_percent: "7.5",
  },
  by_day: [
    { day: "2026-11-13", visitors: 15, page_views: 50 },
    { day: "2026-11-14T00:00:00", visitors: 25, page_views: 80 },
  ],
  by_country: [
    { country: "TR", visitors: 30, page_views: 100 },
    { country: "xx", visitors: 10, page_views: 30 },
  ],
};

describe("store_traffic_summary: mapping and validation", () => {
  it("calls the RPC with the store and range, and maps strings to numbers", async () => {
    m().state.queue.push({ data: summary });
    const r = await storeTrafficService.summary(STORE.id, { from: "2026-11-01", to: "2026-11-14" });
    expect(m().state.rpcs).toEqual([
      {
        fn: "store_traffic_summary",
        args: { p_store_id: STORE.id, p_from: "2026-11-01", p_to: "2026-11-14" },
      },
    ]);
    expect(r.totals).toEqual({
      visitors: 40,
      page_views: 130,
      orders: 3,
      orders_confirmed: 2,
      conversion_percent: 7.5,
    });
    expect(r.by_day[1]?.day).toBe("2026-11-14");
    expect(r.by_country.map((c) => c.country)).toEqual(["TR", "XX"]);
  });

  it("keeps a null conversion as null (never 0) and accepts missing lists", () => {
    const r = trafficSummarySchema.parse({
      totals: {
        visitors: 0,
        page_views: 0,
        orders: 0,
        orders_confirmed: 0,
        conversion_percent: null,
      },
      by_day: null,
    });
    expect(r.totals.conversion_percent).toBeNull();
    expect(r.by_day).toEqual([]);
    expect(r.by_country).toEqual([]);
  });

  it("unwraps a single-element array", async () => {
    m().state.queue.push({ data: [summary] });
    const r = await storeTrafficService.summary(STORE.id, { from: "2026-11-14", to: "2026-11-14" });
    expect(r.totals.visitors).toBe(40);
  });

  it("rejects an unexpected shape with a readable error", async () => {
    m().state.queue.push({ data: { totals: { visitors: -1 } } });
    await expect(
      storeTrafficService.summary(STORE.id, { from: "2026-11-14", to: "2026-11-14" }),
    ).rejects.toThrow(/store_traffic_summary returned an unexpected shape/);
  });

  it("surfaces the database error as it is", async () => {
    m().state.queue.push({
      error: {
        code: "PGRST202",
        message: "Could not find the function public.store_traffic_summary",
      },
    });
    await expect(
      storeTrafficService.summary(STORE.id, { from: "2026-11-14", to: "2026-11-14" }),
    ).rejects.toMatchObject({ code: "PGRST202" });
  });
});

describe("date ranges (UTC)", () => {
  const now = new Date("2026-11-14T23:30:00Z");

  it("presets end today and include it", () => {
    expect(presetRange("today", now)).toEqual({ from: "2026-11-14", to: "2026-11-14" });
    expect(presetRange("7", now)).toEqual({ from: "2026-11-08", to: "2026-11-14" });
    expect(rangeDays(presetRange("30", now))).toBe(30);
    expect(rangeDays(presetRange("90", now))).toBe(90);
  });

  it("validates custom ranges with clear messages", () => {
    expect(validateRange("2026-11-01", "2026-11-14", now)).toEqual({
      ok: true,
      range: { from: "2026-11-01", to: "2026-11-14" },
    });
    expect(validateRange("", "2026-11-14", now)).toEqual({
      ok: false,
      message: "Choose a start and an end date.",
    });
    expect(validateRange("2026-02-30", "2026-03-01", now).ok).toBe(false); // not a real day
    expect(validateRange("2026-11-14", "2026-11-01", now)).toEqual({
      ok: false,
      message: "The start date must be on or before the end date.",
    });
    expect(validateRange("2026-11-01", "2026-11-15", now)).toEqual({
      ok: false,
      message: "The end date can't be in the future.",
    });
    expect(validateRange("2025-11-14", "2026-11-14", now).ok).toBe(true); // 366 days
    expect(validateRange("2025-11-13", "2026-11-14", now)).toEqual({
      ok: false,
      message: "Choose at most 366 days.",
    });
  });
});

describe("percentages and country names", () => {
  it("rounds to one decimal and shows — for no value", () => {
    expect(formatPercent(7.5)).toBe("7.5%");
    expect(formatPercent(2.456)).toBe("2.5%");
    expect(formatPercent(100)).toBe("100%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(null)).toBe("—");
    expect(sharePercent(1, 3)).toBeCloseTo(33.333, 2);
    expect(sharePercent(5, 0)).toBe(0);
  });

  it("flags and English names; XX is Unknown", () => {
    expect(flagEmoji("TR")).toBe("🇹🇷");
    expect(flagEmoji("XX")).toBe("");
    expect(countryName("DE")).toBe("Germany");
    expect(countryName("XX")).toBe("Unknown");
  });
});

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------
describe("TrafficChart", () => {
  it("has a visually hidden table with every day", () => {
    render(
      <TrafficChart
        rows={[
          { day: "2026-11-13", visitors: 15, page_views: 50 },
          { day: "2026-11-14", visitors: 0, page_views: 0 },
        ]}
      />,
    );
    const table = screen.getByTestId("traffic-table");
    expect(table.className).toContain("sr-only");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.textContent)).toEqual([
      "Fri, Nov 13, 20261550",
      "Sat, Nov 14, 202600",
    ]);
  });

  it("renders with no days without crashing", () => {
    render(<TrafficChart rows={[]} />);
    expect(within(screen.getByTestId("traffic-table")).getAllByRole("row")).toHaveLength(1);
  });
});

describe("CountriesTable", () => {
  it("shows flag, name, numbers and share of all visitors", () => {
    render(
      <CountriesTable
        totalVisitors={40}
        rows={[
          { country: "TR", visitors: 30, page_views: 100 },
          { country: "XX", visitors: 10, page_views: 30 },
        ]}
      />,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]!).getByRole("rowheader").textContent).toBe("🇹🇷Türkiye");
    expect(rows[0]!.textContent).toContain("75%");
    expect(within(rows[1]!).getByRole("rowheader").textContent).toBe("Unknown");
    expect(rows[1]!.textContent).toContain("25%");
    expect(screen.getByText(/approximate/)).toBeTruthy();
    expect(screen.queryByText(/top 30/)).toBeNull();
  });

  it("empty, and capped at 30 rows with a note", () => {
    const { unmount } = render(<CountriesTable rows={[]} totalVisitors={0} />);
    expect(screen.getByText("No countries yet in this period.")).toBeTruthy();
    unmount();
    const many = Array.from({ length: 35 }, (_, i) => ({
      country: String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26)),
      visitors: 1,
      page_views: 1,
    }));
    render(<CountriesTable rows={many} totalVisitors={35} />);
    expect(screen.getAllByRole("row")).toHaveLength(31);
    expect(screen.getByText(/Only the top 30 countries are shown/)).toBeTruthy();
  });
});

function renderSection(store = STORE) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TrafficSection store={store} />
    </QueryClientProvider>,
  );
}

describe("TrafficSection", () => {
  it("shows the four cards with real numbers and the UTC note", async () => {
    m().state.queue.push({ data: summary });
    renderSection();
    expect(await screen.findByText("130")).toBeTruthy();
    expect(screen.getByText("7.5%")).toBeTruthy();
    expect(screen.getByText(/Days are in UTC/)).toBeTruthy();
    expect(
      screen.getByText(
        "Visitors are counted once per day per device. Conversion = orders ÷ visitors in this period.",
      ),
    ).toBeTruthy();
    expect(m().state.rpcs[0]?.fn).toBe("store_traffic_summary");
  });

  it("no visitors: conversion is — with a hint, and the empty state with the store link", async () => {
    m().state.queue.push({
      data: {
        totals: {
          visitors: 0,
          page_views: 0,
          orders: 0,
          orders_confirmed: 0,
          conversion_percent: null,
        },
        by_day: [],
        by_country: [],
      },
    });
    renderSection();
    const empty = await screen.findByTestId("traffic-empty");
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("Shown once your store has visitors.")).toBeTruthy();
    expect(empty.textContent).toContain("No visits yet.");
    expect(empty.textContent).toContain("Share your store link to get your first visitors.");
    expect(empty.textContent).toContain("Numbers start from the day this feature was switched on.");
    expect(within(empty).getByRole("link").getAttribute("href")).toContain("beta");
    expect(within(empty).getByRole("button", { name: "Copy link" })).toBeTruthy();
  });

  it("shows the database error text as it is", async () => {
    m().state.queue.push({
      error: {
        code: "PGRST202",
        message: "Could not find the function public.store_traffic_summary",
      },
    });
    renderSection();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not find the function public.store_traffic_summary");
    expect(alert.textContent).toContain("PGRST202");
  });

  it("a custom range over 366 days shows a clear message and makes no call", async () => {
    m().state.queue.push({ data: summary });
    renderSection();
    await screen.findByText("130");
    fireEvent.click(screen.getByRole("radio", { name: "Custom" }));
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2020-01-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2021-06-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect((await screen.findByText("Choose at most 366 days.")).getAttribute("role")).toBe(
      "alert",
    );
    expect(m().state.rpcs).toHaveLength(1);
  });

  it("says when an unpublished store isn't counted yet", async () => {
    m().state.queue.push({ data: summary });
    renderSection({ ...STORE, status: "draft" });
    expect(await screen.findByText(/isn't published yet/)).toBeTruthy();
  });
});
