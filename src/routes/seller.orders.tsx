import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { OrdersPanel } from "@/components/seller/orders-panel";
import { TrackingImport } from "@/components/seller/tracking-import";
import { useSeller } from "@/components/seller/seller-context";
import { SellerPageHeader } from "@/components/seller/seller-shell";
import { ORDER_STATUSES, type OrderStatus } from "@/services/seller";

export const Route = createFileRoute("/seller/orders")({
  ssr: false,
  // ?status=pending&q=sara — filters live in the URL so Home can link to them.
  validateSearch: (s: Record<string, unknown>): { status?: OrderStatus; q?: string } => ({
    ...(ORDER_STATUSES.includes(s["status"] as OrderStatus)
      ? { status: s["status"] as OrderStatus }
      : {}),
    ...(typeof s["q"] === "string" && s["q"] ? { q: s["q"] } : {}),
  }),
  pendingComponent: CatalogSkeleton,
  component: SellerOrdersPage,
});

function SellerOrdersPage() {
  const { store } = useSeller();
  const { status, q } = Route.useSearch();
  const navigate = useNavigate({ from: "/seller/orders" });
  return (
    <div className="seller-page">
      <SellerPageHeader
        title="Orders"
        description="Update the status as you fulfil each order, and add tracking when you ship."
        actions={<TrackingImport stores={[store]} />}
      />
      <OrdersPanel
        stores={[store]}
        status={status ?? ""}
        query={q ?? ""}
        onFiltersChange={(f) =>
          void navigate({
            search: {
              ...(f.status ? { status: f.status as OrderStatus } : {}),
              ...(f.query ? { q: f.query } : {}),
            },
            replace: true,
          })
        }
      />
    </div>
  );
}
