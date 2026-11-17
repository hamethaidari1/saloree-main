import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, ChevronRight, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { useFormat, useLocale } from "@/i18n/hooks";
import { adminService } from "@/services/admin";
import { adminKeys } from "@/components/admin/keys";
import { flagEmoji } from "@/services/store-traffic";
import {
  LIVE_REFRESH_MS,
  pathKind,
  shortVisit,
  SITE_PRESETS,
  siteAnalyticsKeys,
  siteAnalyticsService,
  sitePresetRange,
  SOURCE_TYPES,
  stepPercent,
  visitsAllowed,
  VISITS_PAGE_SIZE,
  type DayRange,
  type ListName,
  type RankedRow,
  type SitePreset,
  type SiteSummary,
  type SiteVisit,
  type SourceType,
} from "@/services/site-analytics";

type Tab = "overview" | "visits";

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------
function useLabels() {
  const { t } = useTranslation("visitors");
  const locale = useLocale();
  const regions = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: "region" });
    } catch {
      return null;
    }
  }, [locale]);
  const languages = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: "language" });
    } catch {
      return null;
    }
  }, [locale]);
  const country = (code: string | null) => {
    const c = code?.toUpperCase() ?? "";
    if (!/^[A-Z]{2}$/.test(c) || c === "XX") return t("unknown");
    try {
      return regions?.of(c) ?? c;
    } catch {
      return c;
    }
  };
  const language = (tag: string | null) => {
    if (!tag) return t("unknown");
    try {
      return languages?.of(tag) ?? tag;
    } catch {
      return tag;
    }
  };
  const source = (s: string | null) =>
    s && (SOURCE_TYPES as readonly string[]).includes(s)
      ? t(`source.${s}`)
      : s
        ? t("source.other")
        : t("unknown");
  const device = (d: string | null) =>
    d && ["desktop", "mobile", "tablet", "other"].includes(d) ? t(`device.${d}`) : t("unknown");
  /** "/product/abc" → "Product" (and the path); "/" → "Home". */
  const page = (path: string | null) => {
    if (!path) return { name: t("unknown"), path: "" };
    const kind = pathKind(path);
    return {
      name: kind === "other" ? path : t(`path.${kind}`),
      path: kind === "other" ? "" : path,
    };
  };
  return { t, country, language, source, device, page };
}

function PageLabel({ path }: { path: string | null }) {
  const { page } = useLabels();
  const p = page(path);
  return (
    <span className="visitors-page">
      <span dir="auto">{p.name}</span>
      {p.path && p.path !== "/" && (
        <bdi className="visitors-path" dir="ltr">
          {p.path}
        </bdi>
      )}
    </span>
  );
}

function CountryLabel({ code, city }: { code: string | null; city?: string | null }) {
  const { country } = useLabels();
  const flag = code ? flagEmoji(code.toUpperCase()) : "";
  return (
    <span>
      {flag && (
        <span aria-hidden="true" className="traffic-flag">
          {flag}
        </span>
      )}
      {city ? (
        <>
          <bdi>{city}</bdi>, {country(code)}
        </>
      ) : (
        country(code)
      )}
    </span>
  );
}

function errorMessage(error: unknown) {
  const e = error as { message?: unknown; code?: unknown } | null;
  const message = typeof e?.message === "string" && e.message ? e.message : String(error);
  return typeof e?.code === "string" && e.code ? `${message} (${e.code})` : message;
}

/** The database's own words, with a retry. */
function LoadError({
  error,
  onRetry,
  title,
}: {
  error: unknown;
  onRetry: () => void;
  title?: string;
}) {
  const { t } = useTranslation("visitors");
  return (
    <div role="alert" className="seller-empty" data-testid="visitors-error">
      <h3>{title ?? t("error.title")}</h3>
      <p>{errorMessage(error)}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t("error.retry")}
      </Button>
    </div>
  );
}

function Skeleton({ rows = 4 }: { rows?: number }) {
  const { t } = useTranslation("visitors");
  return (
    <div className="admin-tiles" aria-busy="true" aria-label={t("visits.loading")}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="admin-tile skeleton" />
      ))}
    </div>
  );
}

function Tile({ label, value, detail }: { label: string; value: string; detail?: ReactNode }) {
  return (
    <div className="admin-tile">
      <span className="admin-tile-label">{label}</span>
      <strong className="admin-tile-value">{value}</strong>
      {detail && <span className="admin-tile-detail">{detail}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
const chartConfig = {
  visitors: { label: "Visitors", color: "var(--traffic-visitors)" },
  page_views: { label: "Page views", color: "var(--traffic-views)" },
} satisfies ChartConfig;

function DayChart({ rows }: { rows: SiteSummary["by_day"] }) {
  const { t } = useTranslation("visitors");
  const fmt = useFormat();
  const day = (d: string) =>
    fmt.date(`${d.slice(0, 10)}T00:00:00Z`, { month: "short", day: "numeric", timeZone: "UTC" });
  const config = {
    visitors: { ...chartConfig.visitors, label: t("cards.visitors") },
    page_views: { ...chartConfig.page_views, label: t("cards.pageViews") },
  } satisfies ChartConfig;
  return (
    <section className="seller-card" aria-labelledby="visitors-chart-title">
      <h3 id="visitors-chart-title" className="mb-4 text-base font-semibold">
        {t("chart.title")}
      </h3>
      <div aria-hidden="true" dir="ltr">
        <ChartContainer config={config} className="aspect-auto h-56 w-full">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              minTickGap={18}
              tickFormatter={day}
            />
            <YAxis width={40} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip labelFormatter={(d: string) => day(d)} />
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
      <table className="sr-only">
        <caption>{t("chart.title")}</caption>
        <thead>
          <tr>
            <th scope="col">{t("chart.day")}</th>
            <th scope="col">{t("cards.visitors")}</th>
            <th scope="col">{t("cards.pageViews")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.day}>
              <th scope="row">{day(r.day)}</th>
              <td>{fmt.number(r.visitors)}</td>
              <td>{fmt.number(r.page_views)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** One ranked list ("Top pages", "Browsers"…) as a table with share bars. */
function RankedTable({
  name,
  rows,
  renderLabel,
  limit = 10,
}: {
  name: ListName;
  rows: RankedRow[];
  renderLabel: (row: RankedRow) => ReactNode;
  limit?: number;
}) {
  const { t } = useTranslation("visitors");
  const fmt = useFormat();
  const shown = rows.slice(0, limit);
  const total = rows.reduce((s, r) => s + r.visits, 0);
  const id = `visitors-list-${name}`;
  return (
    <section className="seller-card visitors-list" aria-labelledby={id} data-testid={id}>
      <h3 id={id} className="mb-3 text-base font-semibold">
        {t(`lists.${name}`)}
      </h3>
      {!shown.length ? (
        <p className="seller-hint">{t("lists.none")}</p>
      ) : (
        <div className="visitors-scroll">
          <table className="seller-order-table">
            <thead>
              <tr>
                <th scope="col">{t(`lists.${name}`)}</th>
                <th scope="col">{t("lists.visits")}</th>
                <th scope="col">{t("lists.share")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const share = total > 0 ? (r.visits / total) * 100 : 0;
                return (
                  <tr key={`${r.label}-${i}`}>
                    <th scope="row">{renderLabel(r)}</th>
                    <td className="tabular-nums">{fmt.number(r.visits)}</td>
                    <td>
                      <span className="traffic-share">
                        <span className="tabular-nums">
                          {fmt.number(share, { maximumFractionDigits: 1 })}%
                        </span>
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
        </div>
      )}
    </section>
  );
}

function Funnel({ reached }: { reached: SiteSummary["reached"] }) {
  const { t } = useTranslation("visitors");
  const fmt = useFormat();
  const steps = [
    ["product", reached.product],
    ["cart", reached.cart],
    ["checkout", reached.checkout],
  ] as const;
  return (
    <section
      className="seller-card"
      aria-labelledby="visitors-funnel"
      data-testid="visitors-funnel"
    >
      <h3 id="visitors-funnel" className="mb-1 text-base font-semibold">
        {t("funnel.title")}
      </h3>
      <p className="seller-hint mb-3">{t("funnel.hint")}</p>
      <ol className="visitors-funnel">
        {steps.map(([key, n]) => {
          const pct = stepPercent(n, reached.product);
          return (
            <li key={key}>
              <span className="visitors-funnel-label">{t(`funnel.${key}`)}</span>
              <strong className="tabular-nums">{fmt.number(n)}</strong>
              <span className="seller-meter" aria-hidden="true">
                <span style={{ inlineSize: `${Math.min(100, pct)}%` }} />
              </span>
              <span className="tabular-nums seller-hint">
                {fmt.number(pct, { maximumFractionDigits: 1 })}%
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function LiveCard({ storeName }: { storeName: (s: string | null) => string | null }) {
  const { t, device } = useLabels();
  const fmt = useFormat();
  // react-query pauses the interval while the browser tab is hidden.
  const live = useQuery({
    queryKey: siteAnalyticsKeys.live,
    queryFn: siteAnalyticsService.live,
    refetchInterval: LIVE_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: false,
  });
  return (
    <section
      className="seller-card visitors-live"
      aria-labelledby="visitors-live"
      data-testid="visitors-live"
    >
      <h3 id="visitors-live" className="mb-1 flex items-center gap-2 text-base font-semibold">
        <Radio size={16} aria-hidden className="visitors-live-icon" />
        {t("live.title")}
      </h3>
      <p className="seller-hint mb-3">{t("live.refresh")}</p>
      {live.isPending ? (
        <Skeleton rows={1} />
      ) : live.isError ? (
        <LoadError error={live.error} title={t("live.error")} onRetry={() => void live.refetch()} />
      ) : (
        <>
          <p className="visitors-live-count" aria-live="polite">
            {t("live.count", { n: fmt.number(live.data.visitors_now) })}
          </p>
          {!live.data.visitors.length ? (
            <p className="seller-hint">{t("live.none")}</p>
          ) : (
            <ul className="visitors-live-list">
              {live.data.visitors.map((v) => (
                <li key={v.visit}>
                  <PageLabel path={v.path} />
                  <span className="seller-hint">
                    <CountryLabel code={v.country} city={v.city} /> · {device(v.device)}
                    {storeName(v.store) && <> · {storeName(v.store)}</>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function Overview({
  range,
  storeId,
  storeName,
}: {
  range: DayRange;
  storeId: string | null;
  storeName: (s: string | null) => string | null;
}) {
  const { t, source, device, language } = useLabels();
  const fmt = useFormat();
  const q = useQuery({
    queryKey: siteAnalyticsKeys.summary(range, storeId),
    queryFn: () => siteAnalyticsService.summary(range, storeId),
    retry: false,
  });
  if (q.isPending) return <Skeleton />;
  if (q.isError) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const empty = d.totals.visitors === 0 && d.totals.page_views === 0;
  const plain = (r: RankedRow) => <bdi>{r.label}</bdi>;
  return (
    <div className="grid gap-4">
      <div className="admin-tiles">
        <Tile
          label={t("cards.visitors")}
          value={fmt.number(d.totals.visitors)}
          detail={t("cards.visitorsHint")}
        />
        <Tile
          label={t("cards.pageViews")}
          value={fmt.number(d.totals.page_views)}
          detail={t("cards.pageViewsHint")}
        />
        <Tile
          label={t("cards.pagesPerVisit")}
          value={
            d.totals.avg_pages_per_visit == null
              ? "—"
              : fmt.number(d.totals.avg_pages_per_visit, { maximumFractionDigits: 1 })
          }
        />
        <Tile
          label={t("cards.bounce")}
          value={
            d.totals.single_page_visits_percent == null
              ? "—"
              : `${fmt.number(d.totals.single_page_visits_percent, { maximumFractionDigits: 1 })}%`
          }
          detail={t("cards.bounceHint")}
        />
      </div>
      {empty ? (
        <div className="seller-empty" data-testid="visitors-empty">
          <h3>{t("empty.title")}</h3>
          <p>{t("empty.text")}</p>
        </div>
      ) : (
        <>
          <DayChart rows={d.by_day} />
          <div className="visitors-grid">
            <RankedTable
              name="top_pages"
              rows={d.top_pages}
              renderLabel={(r) => <PageLabel path={r.label} />}
            />
            <RankedTable
              name="entry_pages"
              rows={d.entry_pages}
              renderLabel={(r) => <PageLabel path={r.label} />}
            />
            <RankedTable name="sources" rows={d.sources} renderLabel={(r) => source(r.label)} />
            <RankedTable name="referrers" rows={d.referrers} renderLabel={plain} />
            <RankedTable
              name="campaigns"
              rows={d.campaigns}
              renderLabel={(r) => {
                const via = [r.extra["utm_source"], r.extra["utm_medium"]]
                  .filter(Boolean)
                  .join(" / ");
                return (
                  <span className="visitors-page">
                    <bdi>{r.label}</bdi>
                    {via && <bdi className="visitors-path">{via}</bdi>}
                  </span>
                );
              }}
            />
            <RankedTable
              name="countries"
              rows={d.countries}
              renderLabel={(r) => <CountryLabel code={r.label} />}
            />
            <RankedTable
              name="cities"
              rows={d.cities}
              renderLabel={(r) => <CountryLabel code={r.extra["country"] ?? null} city={r.label} />}
            />
            <RankedTable name="devices" rows={d.devices} renderLabel={(r) => device(r.label)} />
            <RankedTable name="browsers" rows={d.browsers} renderLabel={plain} />
            <RankedTable name="systems" rows={d.systems} renderLabel={plain} />
            <RankedTable
              name="languages"
              rows={d.languages}
              renderLabel={(r) => language(r.label)}
            />
            {!storeId && (
              <RankedTable
                name="stores"
                rows={d.stores}
                renderLabel={(r) => (
                  <bdi>
                    {r.extra["store_name"] ?? r.extra["name"] ?? storeName(r.label) ?? r.label}
                  </bdi>
                )}
              />
            )}
            <Funnel reached={d.reached} />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------
function VisitRow({
  visit,
  storeName,
}: {
  visit: SiteVisit;
  storeName: (s: string | null) => string | null;
}) {
  const { t, source, device } = useLabels();
  const fmt = useFormat();
  const [open, setOpen] = useState(false);
  const code = shortVisit(visit.visit);
  const journeyId = `visit-journey-${code}`;
  const time = (v: string | null) =>
    v ? fmt.date(v, { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
  const from = [source(visit.source_type), visit.referrer_host].filter(Boolean).join(" · ");
  return (
    <li className="seller-row visitors-visit" data-testid="visit-row">
      <div className="min-w-0 flex-1">
        <p className="seller-row-title">{t("visits.visit", { code })}</p>
        <p className="seller-row-meta">
          <CountryLabel code={visit.country} city={visit.city} />
          <span aria-hidden>·</span>
          {[device(visit.device), visit.browser, visit.os].filter(Boolean).join(" / ")}
        </p>
        <p className="seller-row-meta">
          <bdi>{from}</bdi>
          {visit.utm_campaign && (
            <>
              <span aria-hidden>·</span>
              <bdi>{visit.utm_campaign}</bdi>
            </>
          )}
          <span aria-hidden>·</span>
          {visit.first_seen ? fmt.dateTime(visit.first_seen) : visit.day}
          <span aria-hidden>·</span>
          {t("visits.pages", { n: fmt.number(visit.pages) })}
        </p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-expanded={open}
        aria-controls={journeyId}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? (
          <ChevronDown aria-hidden />
        ) : (
          <ChevronRight aria-hidden className="rtl:-scale-x-100" />
        )}
        {open ? t("visits.hideJourney") : t("visits.showJourney")}
      </Button>
      {open && (
        <ol id={journeyId} className="visitors-journey" aria-label={t("visits.journey")}>
          {visit.journey.map((step, i) => (
            <li key={i}>
              <time className="tabular-nums seller-hint" dateTime={step.t ?? undefined}>
                {time(step.t)}
              </time>
              <PageLabel path={step.path} />
              {storeName(step.store) && (
                <span className="seller-hint">{storeName(step.store)}</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

function Visits({
  range,
  preset,
  storeId,
  storeName,
  countries,
}: {
  range: DayRange;
  preset: SitePreset;
  storeId: string | null;
  storeName: (s: string | null) => string | null;
  countries: string[];
}) {
  const { t, source, country: countryName } = useLabels();
  const fmt = useFormat();
  const [country, setCountry] = useState("");
  const [src, setSrc] = useState<SourceType | "">("");
  const [page, setPage] = useState(0);
  const allowed = visitsAllowed(preset);
  const filter = { range, country: country || null, source: src || null, storeId, page };
  const q = useQuery({
    queryKey: siteAnalyticsKeys.visits(filter),
    queryFn: () => siteAnalyticsService.visits(filter),
    enabled: allowed,
    retry: false,
  });
  if (!allowed)
    return (
      <p className="seller-hint" role="note" data-testid="visits-range-hint">
        {t("visits.rangeHint")}
      </p>
    );
  const pages = q.data ? Math.max(1, Math.ceil(q.data.total / VISITS_PAGE_SIZE)) : 1;
  return (
    <div className="grid gap-4">
      <p className="seller-hint">{t("visits.rangeHint")}</p>
      <div className="staff-filters">
        <select
          aria-label={t("visits.country")}
          className="staff-select"
          value={country}
          onChange={(e) => {
            setCountry(e.target.value);
            setPage(0);
          }}
        >
          <option value="">{t("visits.anyCountry")}</option>
          {countries.map((c) => (
            <option key={c} value={c}>
              {countryName(c)}
            </option>
          ))}
        </select>
        <select
          aria-label={t("visits.source")}
          className="staff-select"
          value={src}
          onChange={(e) => {
            setSrc(e.target.value as SourceType | "");
            setPage(0);
          }}
        >
          <option value="">{t("visits.anySource")}</option>
          {SOURCE_TYPES.map((s) => (
            <option key={s} value={s}>
              {source(s)}
            </option>
          ))}
        </select>
      </div>
      {q.isPending ? (
        <Skeleton rows={2} />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => void q.refetch()} />
      ) : !q.data.visits.length ? (
        <div className="seller-empty" data-testid="visitors-empty">
          <h3>{t("empty.title")}</h3>
          <p>{t("empty.text")}</p>
        </div>
      ) : (
        <>
          <p className="seller-hint">{t("visits.total", { n: fmt.number(q.data.total) })}</p>
          <ul className="seller-list">
            {q.data.visits.map((v) => (
              <VisitRow key={v.visit} visit={v} storeName={storeName} />
            ))}
          </ul>
          {pages > 1 && (
            <nav
              className="visitors-pager"
              aria-label={t("visits.page", { page: page + 1, pages })}
            >
              <Button
                size="sm"
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                {t("visits.previous")}
              </Button>
              <span className="tabular-nums">{t("visits.page", { page: page + 1, pages })}</span>
              <Button
                size="sm"
                variant="outline"
                disabled={page + 1 >= pages}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("visits.next")}
              </Button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

/** Site-wide visitor analytics. Admin and content_admin (the database checks). */
export function VisitorsPanel() {
  const { t } = useTranslation("visitors");
  const [preset, setPreset] = useState<SitePreset>("7");
  const [storeId, setStoreId] = useState<string>("");
  const [tab, setTab] = useState<Tab>("overview");
  const range = useMemo(() => sitePresetRange(preset), [preset]);
  const stores = useQuery({ queryKey: adminKeys.stores, queryFn: adminService.listStores });
  const names = useMemo(
    () => new Map((stores.data ?? []).map((s) => [s.id, s.name])),
    [stores.data],
  );
  const storeName = (s: string | null) => (s ? (names.get(s) ?? s) : null);
  const summary = useQuery({
    queryKey: siteAnalyticsKeys.summary(range, storeId || null),
    queryFn: () => siteAnalyticsService.summary(range, storeId || null),
    enabled: tab === "visits",
    retry: false,
  });
  const countries = (summary.data?.countries ?? [])
    .map((c) => c.label.toUpperCase())
    .filter((c) => /^[A-Z]{2}$/.test(c));

  return (
    <section aria-labelledby="visitors-heading" className="grid gap-4">
      <div className="seller-panel-head">
        <div>
          <h2 id="visitors-heading">{t("title")}</h2>
          <p>{t("intro")}</p>
        </div>
        <div className="staff-filters">
          <div role="radiogroup" aria-label={t("range.label")} className="seller-segmented">
            {SITE_PRESETS.map((p) => {
              const off = tab === "visits" && !visitsAllowed(p);
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={preset === p}
                  disabled={off}
                  title={off ? t("visits.disabledRange") : undefined}
                  onClick={() => setPreset(p)}
                >
                  {t(`range.${p}`)}
                </button>
              );
            })}
          </div>
          <select
            aria-label={t("store.label")}
            className="staff-select"
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
          >
            <option value="">{t("store.all")}</option>
            {(stores.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="seller-hint" data-testid="visitors-privacy">
        {t("privacy")} {t("utc")}
      </p>

      <div role="tablist" aria-label={t("title")} className="seller-segmented visitors-tabs">
        {(["overview", "visits"] as const).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            id={`visitors-tab-${v}`}
            aria-selected={tab === v}
            aria-controls={`visitors-tabpanel-${v}`}
            onClick={() => {
              setTab(v);
              // The visit list covers at most 7 days.
              if (v === "visits" && !visitsAllowed(preset)) setPreset("7");
            }}
          >
            {t(`tabs.${v}`)}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`visitors-tabpanel-${tab}`}
        aria-labelledby={`visitors-tab-${tab}`}
        className="grid gap-4"
      >
        {tab === "overview" ? (
          <>
            <LiveCard storeName={storeName} />
            <Overview range={range} storeId={storeId || null} storeName={storeName} />
          </>
        ) : (
          <Visits
            key={`${range.from}-${range.to}-${storeId}`}
            range={range}
            preset={preset}
            storeId={storeId || null}
            storeName={storeName}
            countries={countries}
          />
        )}
      </div>
    </section>
  );
}
