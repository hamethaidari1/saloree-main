import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { useSeller } from "@/components/seller/seller-context";
import { SellerPageHeader } from "@/components/seller/seller-shell";
import { TrafficSection } from "@/components/seller/traffic";
import {
  formatCount,
  QueryError,
  SalesChart,
  StatTile,
  TilesSkeleton,
} from "@/components/seller/stats";
import { money } from "@/services/catalog";
import {
  ANALYTICS_RANGES,
  sellerDashboardService,
  type AnalyticsRange,
} from "@/services/seller-dashboard";

export const Route = createFileRoute("/seller/analytics")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { days?: AnalyticsRange } => {
    const d = Number(s["days"]);
    return ANALYTICS_RANGES.includes(d as AnalyticsRange) ? { days: d as AnalyticsRange } : {};
  },
  pendingComponent: CatalogSkeleton,
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const { store } = useSeller();
  const { days = 30 } = Route.useSearch();
  const navigate = useNavigate({ from: "/seller/analytics" });
  const q = useQuery({
    // The active store only; its id is in the key so switching never shows another store's numbers.
    queryKey: ["seller", "analytics", store.id, days],
    queryFn: () => sellerDashboardService.analytics(days, store.id),
  });
  const total = q.data?.orders_by_status.reduce((s, r) => s + r.count, 0) ?? 0;

  return (
    <div className="seller-page">
      <SellerPageHeader
        title="Analytics"
        description={store.name}
        actions={
          <div role="radiogroup" aria-label="Sales period" className="seller-segmented">
            {ANALYTICS_RANGES.map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={days === d}
                onClick={() => void navigate({ search: { days: d }, replace: true })}
              >
                {d} days
              </button>
            ))}
          </div>
        }
      />

      <TrafficSection store={store} />

      <h2 className="mt-8 mb-3 text-lg font-semibold">Sales</h2>
      {q.isPending ? (
        <TilesSkeleton count={8} />
      ) : q.isError ? (
        <QueryError query={q} title="Analytics could not be loaded." />
      ) : (
        <div className="grid gap-4">
          <div className="admin-tiles">
            <StatTile label="Gross sales" value={money(q.data.gross_sales)} />
            <StatTile label="Orders" value={formatCount(q.data.orders)} />
            <StatTile
              label="Net earnings"
              value={money(q.data.net_earnings)}
              detail="After platform commission"
            />
            <StatTile label="Commission paid" value={money(q.data.commission_paid)} />
            <StatTile label="Discounts given" value={money(q.data.discounts_given)} />
            <StatTile label="Average order value" value={money(q.data.average_order_value)} />
            <StatTile label="Cancelled orders" value={formatCount(q.data.cancelled_orders)} />
          </div>

          <SalesChart rows={q.data.by_day} title={`Sales by day, last ${days} days`} />

          <div className="seller-home-grid">
            <section className="seller-card" aria-labelledby="by-status">
              <h2 id="by-status" className="mb-3 text-base font-semibold">
                Orders by status
              </h2>
              {!q.data.orders_by_status.length ? (
                <p className="seller-hint">No orders in this period.</p>
              ) : (
                <ul className="grid gap-2">
                  {[...q.data.orders_by_status]
                    .sort((a, b) => b.count - a.count)
                    .map((r) => (
                      <li key={r.status} className="grid gap-1">
                        <span className="flex justify-between text-sm">
                          <span className="capitalize">{r.status}</span>
                          <span className="tabular-nums">
                            {formatCount(r.count)}
                            <span className="text-muted-foreground">
                              {" "}
                              ({Math.round((r.count / (total || 1)) * 100)}%)
                            </span>
                          </span>
                        </span>
                        <span className="seller-meter" aria-hidden>
                          <span style={{ inlineSize: `${(r.count / (total || 1)) * 100}%` }} />
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </section>

            <section className="seller-card" aria-labelledby="top-products">
              <h2 id="top-products" className="mb-3 text-base font-semibold">
                Top products
              </h2>
              {!q.data.top_products.length ? (
                <p className="seller-hint">No products sold in this period.</p>
              ) : (
                <table className="seller-order-table">
                  <thead>
                    <tr>
                      <th scope="col">Product</th>
                      <th scope="col">Sold</th>
                      <th scope="col">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.top_products.slice(0, 5).map((p, i) => (
                      <tr key={p.product_id ?? `${p.title}-${i}`}>
                        <td>{p.title ?? "Deleted product"}</td>
                        <td>{formatCount(p.quantity)}</td>
                        <td>{money(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
