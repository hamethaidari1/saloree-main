import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { StoreRow } from "@/data/db";
import { storeUrl } from "@/lib/host";
import {
  countryName,
  flagEmoji,
  formatPercent,
  MAX_COUNTRIES,
  presetRange,
  sharePercent,
  storeTrafficService,
  TRAFFIC_PRESETS,
  validateRange,
  type DayRange,
  type TrafficPreset,
  type TrafficSummary,
} from "@/services/store-traffic";
import { formatCount, shortDay, StatTile, TilesSkeleton } from "./stats";

type DayRow = TrafficSummary["by_day"][number];
type CountryRow = TrafficSummary["by_country"][number];

const chartConfig = {
  visitors: { label: "Visitors", color: "var(--traffic-visitors)" },
  page_views: { label: "Page views", color: "var(--traffic-views)" },
} satisfies ChartConfig;

function DayTooltip({ active, payload }: { active?: boolean; payload?: { payload: DayRow }[] }) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{shortDay(row.day, true)}</p>
      <p>
        {formatCount(row.visitors)} visitor{row.visitors === 1 ? "" : "s"} ·{" "}
        {formatCount(row.page_views)} page view{row.page_views === 1 ? "" : "s"}
      </p>
    </div>
  );
}

/** Visitors and page views per day, with a visually hidden table for screen readers. */
export function TrafficChart({ rows }: { rows: DayRow[] }) {
  return (
    <section className="seller-card" aria-labelledby="traffic-chart-title">
      <h3 id="traffic-chart-title" className="mb-4 text-base font-semibold">
        Visitors and page views by day
      </h3>
      <div aria-hidden="true">
        <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              minTickGap={18}
              tickFormatter={(d: string) => shortDay(d)}
            />
            <YAxis width={40} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip content={<DayTooltip />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Line
              type="monotone"
              dataKey="visitors"
              stroke="var(--color-visitors)"
              strokeWidth={2}
              dot={rows.length <= 1}
            />
            <Line
              type="monotone"
              dataKey="page_views"
              stroke="var(--color-page_views)"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={rows.length <= 1}
            />
          </LineChart>
        </ChartContainer>
      </div>
      <table className="sr-only" data-testid="traffic-table">
        <caption>Visitors and page views by day (UTC)</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Visitors</th>
            <th scope="col">Page views</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.day}>
              <th scope="row">{shortDay(r.day, true)}</th>
              <td>{formatCount(r.visitors)}</td>
              <td>{formatCount(r.page_views)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Top countries with share of visitors and a thin bar. */
export function CountriesTable({
  rows,
  totalVisitors,
}: {
  rows: CountryRow[];
  totalVisitors: number;
}) {
  const shown = rows.slice(0, MAX_COUNTRIES);
  return (
    <section className="seller-card" aria-labelledby="traffic-countries-title">
      <h3 id="traffic-countries-title" className="mb-1 text-base font-semibold">
        Top countries
      </h3>
      <p className="seller-hint mb-3">
        Countries come from the visitor's internet connection, so they are approximate.
      </p>
      {!shown.length ? (
        <p className="seller-hint">No countries yet in this period.</p>
      ) : (
        <>
          <table className="seller-order-table traffic-countries">
            <thead>
              <tr>
                <th scope="col">Country</th>
                <th scope="col">Visitors</th>
                <th scope="col">Page views</th>
                <th scope="col">Share of visitors</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const share = sharePercent(c.visitors, totalVisitors);
                const flag = flagEmoji(c.country);
                return (
                  <tr key={c.country}>
                    <th scope="row">
                      {flag && (
                        <span aria-hidden="true" className="traffic-flag">
                          {flag}
                        </span>
                      )}
                      {countryName(c.country)}
                    </th>
                    <td>{formatCount(c.visitors)}</td>
                    <td>{formatCount(c.page_views)}</td>
                    <td>
                      <span className="traffic-share">
                        <span className="tabular-nums">{formatPercent(share)}</span>
                        <span className="seller-meter" aria-hidden="true">
                          <span style={{ inlineSize: `${Math.min(100, share)}%` }} />
                        </span>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length >= MAX_COUNTRIES && (
            <p className="seller-hint mt-2">
              Only the top {MAX_COUNTRIES} countries are shown; the rest is not available.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** A new store: no visits yet. */
export function TrafficEmpty({ slug }: { slug: string }) {
  const url = storeUrl(slug);
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  const copy = () => {
    const done = navigator.clipboard?.writeText(url);
    if (!done) return setCopied("no");
    done.then(
      () => setCopied("yes"),
      () => setCopied("no"),
    );
  };
  return (
    <div className="seller-empty" data-testid="traffic-empty">
      <h3>No visits yet.</h3>
      <p>Share your store link to get your first visitors.</p>
      <p className="traffic-link">
        <a href={url} target="_blank" rel="noopener noreferrer" dir="ltr">
          {url}
        </a>
        <Button type="button" variant="outline" size="sm" onClick={copy}>
          Copy link
        </Button>
      </p>
      <p role="status" className="seller-hint">
        {copied === "yes"
          ? "Link copied."
          : copied === "no"
            ? "Couldn't copy. Select the link and copy it yourself."
            : ""}
      </p>
      <p className="seller-hint">Numbers start from the day this feature was switched on.</p>
    </div>
  );
}

/** The database's own error text, as it is. */
function TrafficError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const e = error as { message?: unknown; code?: unknown } | null;
  const message = typeof e?.message === "string" && e.message ? e.message : String(error);
  return (
    <div role="alert" className="seller-empty">
      <h3>Traffic could not be loaded.</h3>
      <p>
        {message}
        {typeof e?.code === "string" && e.code ? ` (${e.code})` : ""}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function RangePicker({
  preset,
  onPreset,
  onCustom,
  custom,
}: {
  preset: TrafficPreset;
  onPreset: (p: Exclude<TrafficPreset, "custom">) => void;
  onCustom: (r: DayRange) => void;
  custom: DayRange;
}) {
  const [open, setOpen] = useState(preset === "custom");
  const [from, setFrom] = useState(custom.from);
  const [to, setTo] = useState(custom.to);
  const [message, setMessage] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const check = validateRange(from, to);
    if (!check.ok) return setMessage(check.message);
    setMessage(null);
    onCustom(check.range);
  };
  return (
    <div className="grid gap-3">
      <div role="radiogroup" aria-label="Traffic period" className="seller-segmented">
        {TRAFFIC_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={p.id === "custom" ? open : !open && preset === p.id}
            onClick={() => {
              if (p.id === "custom") return setOpen(true);
              setOpen(false);
              setMessage(null);
              onPreset(p.id);
            }}
          >
            {p.label}
          </button>
        ))}
      </div>
      {open && (
        <form className="traffic-custom" onSubmit={submit} noValidate>
          <label>
            <span>From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label>
            <span>To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <Button type="submit" size="sm">
            Show
          </Button>
          {message && (
            <p role="alert" className="traffic-error">
              {message}
            </p>
          )}
        </form>
      )}
    </div>
  );
}

const rangeLabel = (r: DayRange) =>
  r.from === r.to ? shortDay(r.from, true) : `${shortDay(r.from, true)} – ${shortDay(r.to, true)}`;

/** Store traffic for the selected store: range, cards, chart and countries. */
export function TrafficSection({ store }: { store: Pick<StoreRow, "id" | "slug" | "status"> }) {
  const [preset, setPreset] = useState<TrafficPreset>("30");
  const [range, setRange] = useState<DayRange>(() => presetRange("30"));
  const q = useQuery({
    queryKey: ["seller", "traffic", store.id, range.from, range.to],
    queryFn: () => storeTrafficService.summary(store.id, range),
    retry: false,
  });
  const totals = q.data?.totals;
  const noVisits = !!totals && totals.visitors === 0 && totals.page_views === 0;

  return (
    <section className="grid gap-4" aria-labelledby="traffic-title">
      <div className="traffic-head">
        <div>
          <h2 id="traffic-title" className="text-lg font-semibold">
            Store traffic
          </h2>
          <p className="seller-hint">
            {rangeLabel(range)}. Days are in UTC (Coordinated Universal Time).
          </p>
        </div>
        <RangePicker
          preset={preset}
          custom={range}
          onPreset={(p) => {
            setPreset(p);
            setRange(presetRange(p));
          }}
          onCustom={(r) => {
            setPreset("custom");
            setRange(r);
          }}
        />
      </div>

      {store.status !== "published" && (
        <p className="seller-hint">
          Your store isn't published yet, so visits aren't counted until it is.
        </p>
      )}

      {q.isPending ? (
        <TilesSkeleton count={4} />
      ) : q.isError ? (
        <TrafficError error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div className="admin-tiles">
            <StatTile
              label="Visitors"
              value={formatCount(q.data.totals.visitors)}
              detail="Counted once per day per device."
            />
            <StatTile
              label="Page views"
              value={formatCount(q.data.totals.page_views)}
              detail="Every store page opened."
            />
            <StatTile
              label="Orders"
              value={formatCount(q.data.totals.orders)}
              detail="Orders in this period, not counting cancelled ones."
            />
            <StatTile
              label="Conversion rate"
              value={
                q.data.totals.visitors > 0 ? formatPercent(q.data.totals.conversion_percent) : "—"
              }
              detail={
                q.data.totals.visitors > 0
                  ? "Orders ÷ visitors in this period."
                  : "Shown once your store has visitors."
              }
            />
          </div>
          <p className="seller-hint">
            Visitors are counted once per day per device. Conversion = orders ÷ visitors in this
            period.
          </p>
          {noVisits ? (
            <TrafficEmpty slug={store.slug} />
          ) : (
            <div className="grid gap-4">
              <TrafficChart rows={q.data.by_day} />
              <CountriesTable rows={q.data.by_country} totalVisitors={q.data.totals.visitors} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
