import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, ImageOff, Inbox } from "lucide-react";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { useSeller } from "@/components/seller/seller-context";
import { SellerPageHeader } from "@/components/seller/seller-shell";
import {
  formatCount,
  QueryError,
  SalesChart,
  StatTile,
  TilesSkeleton,
} from "@/components/seller/stats";
import { money } from "@/services/catalog";
import { LOW_STOCK_THRESHOLD, sellerDashboardService } from "@/services/seller-dashboard";

export const Route = createFileRoute("/seller/")({
  ssr: false,
  pendingComponent: CatalogSkeleton,
  component: SellerHome,
});

function SellerHome() {
  const { user, stores } = useSeller();
  const storeIds = stores.map((s) => s.id);
  const analytics = useQuery({
    queryKey: ["seller", "analytics", 7],
    queryFn: () => sellerDashboardService.analytics(7),
  });
  const pending = useQuery({
    queryKey: ["seller", "pending-count", ...storeIds],
    queryFn: () => sellerDashboardService.pendingOrdersCount(storeIds),
  });
  const lowStock = useQuery({
    queryKey: ["seller", "low-stock", ...storeIds],
    queryFn: () => sellerDashboardService.lowStock(storeIds),
  });
  const name = String(user.user_metadata?.["full_name"] ?? "").split(/\s+/)[0];

  return (
    <div className="seller-page">
      <SellerPageHeader
        title={name ? `Welcome back, ${name}` : "Home"}
        description={`Last 7 days${stores.length > 1 ? " · all your stores" : ""}`}
      />

      {analytics.isPending ? (
        <TilesSkeleton />
      ) : analytics.isError ? (
        <QueryError query={analytics} title="Your sales summary could not be loaded." />
      ) : (
        <>
          <div className="admin-tiles">
            <StatTile label="Gross sales" value={money(analytics.data.gross_sales)} />
            <StatTile label="Orders" value={formatCount(analytics.data.orders)} />
            <StatTile
              label="Net earnings"
              value={money(analytics.data.net_earnings)}
              detail="After platform commission"
            />
            <StatTile
              label="Average order value"
              value={money(analytics.data.average_order_value)}
            />
          </div>
          <div className="mt-4">
            <SalesChart rows={analytics.data.by_day} title="Sales, last 7 days" />
          </div>
        </>
      )}

      <div className="seller-home-grid mt-4">
        <section className="seller-card" aria-labelledby="todo-orders">
          <h2 id="todo-orders" className="mb-3 flex items-center gap-2 text-base font-semibold">
            <Inbox size={18} aria-hidden /> Orders to fulfil
          </h2>
          {pending.isPending ? (
            <div className="nav-skeleton" aria-busy="true" />
          ) : pending.isError ? (
            <QueryError query={pending} title="Pending orders could not be counted." />
          ) : pending.data === 0 ? (
            <p className="seller-hint">No pending orders. You're all caught up.</p>
          ) : (
            <Link to="/seller/orders" search={{ status: "pending" }} className="seller-cta-link">
              <span>
                <strong>{formatCount(pending.data)}</strong> pending order
                {pending.data === 1 ? "" : "s"}
              </span>
              <ArrowRight size={16} aria-hidden className="rtl:-scale-x-100" />
            </Link>
          )}
        </section>

        <section className="seller-card" aria-labelledby="low-stock">
          <h2 id="low-stock" className="mb-3 flex items-center gap-2 text-base font-semibold">
            <AlertTriangle size={18} aria-hidden /> Low stock
            <span className="seller-hint font-normal">
              (active, {LOW_STOCK_THRESHOLD} or fewer)
            </span>
          </h2>
          {lowStock.isPending ? (
            <div className="nav-skeleton" aria-busy="true" />
          ) : lowStock.isError ? (
            <QueryError query={lowStock} title="Low-stock products could not be loaded." />
          ) : !lowStock.data.length ? (
            <p className="seller-hint">
              Every active product has more than {LOW_STOCK_THRESHOLD} in stock.
            </p>
          ) : (
            <>
              <ul className="grid gap-2">
                {lowStock.data.map((p) => (
                  <li key={p.id} className="flex items-center gap-3">
                    <span className="seller-thumb size-9">
                      {p.featured_image ? (
                        <img src={p.featured_image} alt="" loading="lazy" />
                      ) : (
                        <ImageOff size={14} aria-hidden />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">{p.title}</span>
                    <span
                      className={p.stock < 1 ? "text-sm text-destructive" : "text-sm font-medium"}
                    >
                      {p.stock < 1 ? "Out of stock" : `${p.stock} left`}
                    </span>
                  </li>
                ))}
              </ul>
              <Link to="/seller/inventory" className="seller-cta-link mt-3">
                <span>Update stock in Inventory</span>
                <ArrowRight size={16} aria-hidden className="rtl:-scale-x-100" />
              </Link>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
