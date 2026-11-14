import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { useSeller } from "@/components/seller/seller-context";
import { SellerPageHeader } from "@/components/seller/seller-shell";
import { TilesSkeleton } from "@/components/seller/stats";
import {
  EarningsCards,
  EarningsOrdersTable,
  PayoutDetails,
  PayoutHistory,
  PayoutLoadError,
  PayoutRules,
  payoutKeys,
} from "@/components/seller/payouts-panels";
import { payoutsService } from "@/services/payouts";
import { PayoutVerificationNotice } from "@/components/seller/verification/status";

export const Route = createFileRoute("/seller/payouts")({
  ssr: false,
  head: () => ({ meta: [{ title: "Payouts — Saloree" }, { name: "robots", content: "noindex" }] }),
  pendingComponent: CatalogSkeleton,
  component: PayoutsPage,
});

function PayoutsPage() {
  const { store, user } = useSeller();
  const id = store.id;
  const earnings = useQuery({
    queryKey: payoutKeys.earnings(id),
    queryFn: () => payoutsService.earnings(id),
  });
  const orders = useQuery({
    queryKey: payoutKeys.orders(id),
    queryFn: () => payoutsService.earningsOrders(id),
  });
  const entries = useQuery({
    queryKey: payoutKeys.entries(id),
    queryFn: () => payoutsService.entries(id),
  });

  return (
    <div className="seller-page">
      <SellerPageHeader
        title="Payouts"
        description="What you've earned, what's on its way, and where we pay you."
      />
      <div className="grid gap-6">
        <PayoutVerificationNotice userId={user.id} />
        {earnings.isPending ? (
          <TilesSkeleton count={4} />
        ) : earnings.isError ? (
          <PayoutLoadError
            what="Your earnings"
            error={earnings.error}
            retry={() => void earnings.refetch()}
          />
        ) : (
          <>
            <EarningsCards e={earnings.data} orders={orders.data} />
            <PayoutDetails
              storeId={id}
              payable={earnings.data.payable}
              currency={earnings.data.currency}
            />
            <PayoutRules e={earnings.data} />
          </>
        )}

        <section className="seller-card" aria-labelledby="earnings-orders-heading">
          <h2 id="earnings-orders-heading" className="mb-3 text-base font-semibold">
            Orders
          </h2>
          {orders.isPending ? (
            <div className="nav-skeleton" aria-busy="true" aria-label="Loading orders" />
          ) : orders.isError ? (
            <PayoutLoadError
              what="Your orders"
              error={orders.error}
              retry={() => void orders.refetch()}
            />
          ) : (
            <EarningsOrdersTable orders={orders.data} currency={earnings.data?.currency ?? "USD"} />
          )}
        </section>

        <section className="seller-card" aria-labelledby="payout-history-heading">
          <h2 id="payout-history-heading" className="mb-3 text-base font-semibold">
            Payout history
          </h2>
          {entries.isPending ? (
            <div className="nav-skeleton" aria-busy="true" aria-label="Loading payout history" />
          ) : entries.isError ? (
            <PayoutLoadError
              what="Your payout history"
              error={entries.error}
              retry={() => void entries.refetch()}
            />
          ) : (
            <PayoutHistory entries={entries.data} />
          )}
        </section>
      </div>
    </div>
  );
}
