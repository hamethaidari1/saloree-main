import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { money } from "@/services/catalog";
import { friendlyError } from "@/services/errors";

const fmt = new Intl.NumberFormat("en-US");
export const formatCount = (n: number) => fmt.format(n);

/** "2026-11-12" → "Nov 12"; read as UTC so the label never shifts a day. */
export function shortDay(day: string, long = false) {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(long ? { weekday: "short", year: "numeric" } : {}),
    timeZone: "UTC",
  });
}

/**
 * Fills days missing *between* the first and last returned day with zero
 * (no orders that day). Never invents days outside what the server returned.
 */
export function fillDayGaps<T extends { day: string; orders: number; sales: number }>(rows: T[]) {
  const sorted = [...rows].sort((a, b) => a.day.localeCompare(b.day));
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return [];
  const byDay = new Map(sorted.map((r) => [r.day.slice(0, 10), r]));
  const out: { day: string; orders: number; sales: number }[] = [];
  for (
    let t = Date.parse(`${first.day.slice(0, 10)}T00:00:00Z`);
    t <= Date.parse(`${last.day.slice(0, 10)}T00:00:00Z`);
    t += 86_400_000
  ) {
    const key = new Date(t).toISOString().slice(0, 10);
    const r = byDay.get(key);
    out.push({ day: key, orders: r?.orders ?? 0, sales: r?.sales ?? 0 });
  }
  return out;
}

export function StatTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: ReactNode;
}) {
  return (
    <div className="admin-tile">
      <span className="admin-tile-label">{label}</span>
      <strong className="admin-tile-value">{value}</strong>
      {detail && <span className="admin-tile-detail">{detail}</span>}
    </div>
  );
}

export function TilesSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="admin-tiles" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="admin-tile skeleton" />
      ))}
    </div>
  );
}

export function QueryError({ query, title }: { query: UseQueryResult; title: string }) {
  return (
    <div role="alert" className="seller-empty">
      <h3>{title}</h3>
      <p>{friendlyError(query.error)}</p>
      <Button variant="outline" size="sm" onClick={() => query.refetch()}>
        Try again
      </Button>
    </div>
  );
}

const chartConfig = { sales: { label: "Sales", color: "var(--primary)" } } satisfies ChartConfig;

type DayRow = { day: string; orders: number; sales: number };

function DayTooltip({ active, payload }: { active?: boolean; payload?: { payload: DayRow }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{shortDay(row.day, true)}</p>
      <p>
        {money(row.sales)} · {formatCount(row.orders)} order{row.orders === 1 ? "" : "s"}
      </p>
    </div>
  );
}

/** Daily sales bars (single series, so no legend: the title names it). */
export function SalesChart({ rows, title }: { rows: DayRow[]; title: string }) {
  const data = fillDayGaps(rows);
  const hasSales = data.some((d) => d.sales > 0 || d.orders > 0);
  return (
    <section className="seller-card" aria-labelledby="sales-chart-title">
      <h2 id="sales-chart-title" className="mb-4 text-base font-semibold">
        {title}
      </h2>
      {!hasSales ? (
        <p className="seller-hint py-10 text-center">No sales in this period yet.</p>
      ) : (
        <>
          <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="day"
                tickLine={false}
                axisLine={false}
                minTickGap={18}
                tickFormatter={(d: string) => shortDay(d)}
              />
              <YAxis
                width={56}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => money(v).replace(/\.00$/, "")}
              />
              <Tooltip cursor={{ fill: "var(--muted)" }} content={<DayTooltip />} />
              <Bar
                dataKey="sales"
                fill="var(--color-sales)"
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
            </BarChart>
          </ChartContainer>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
            <table className="seller-order-table">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Orders</th>
                  <th scope="col">Sales</th>
                </tr>
              </thead>
              <tbody>
                {data.map((d) => (
                  <tr key={d.day}>
                    <td>{shortDay(d.day, true)}</td>
                    <td>{formatCount(d.orders)}</td>
                    <td>{money(d.sales)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
