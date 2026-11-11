import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CatalogSkeleton, EmptyState, useCatalog } from "@/components/marketplace/shared";
import { requireAuth } from "@/lib/auth";
import { money } from "@/services/catalog";
import { checkoutService } from "@/services/checkout";

export const Route = createFileRoute("/order-confirmation/$groupId")({
  ssr: false,
  beforeLoad: requireAuth(),
  head: () => ({
    meta: [{ title: "Order confirmed — Saloree" }, { name: "robots", content: "noindex" }],
  }),
  pendingComponent: CatalogSkeleton,
  component: ConfirmationPage,
});

function ConfirmationPage() {
  const { groupId } = Route.useParams();
  const { stores } = useCatalog();
  // Right after checkout this is the place_order result (seeded into the cache);
  // after a reload it is rebuilt from the saved orders.
  const result = useQuery({
    queryKey: ["checkout", groupId],
    queryFn: () => checkoutService.getCheckoutGroup(groupId),
    staleTime: Infinity,
  });

  if (result.isPending) return <CatalogSkeleton />;
  if (result.isError || !result.data)
    return (
      <main className="market-container">
        <EmptyState
          title="We couldn't find that order"
          description="If you just placed it, check My orders in your account."
        />
      </main>
    );

  const { total, currency, orders } = result.data;
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name;
  return (
    <main className="market-container auth-page">
      <section className="auth-card confirmation" aria-labelledby="confirm-heading">
        <CircleCheck className="mx-auto text-primary" size={40} aria-hidden />
        <h1 id="confirm-heading" className="page-title text-center">
          Thank you — your order is placed
        </h1>
        <p className="page-subtitle text-center">
          You'll pay on delivery. Each store will prepare its part of your order.
        </p>
        <ul className="checkout-lines mt-6">
          {orders.map((o) => (
            <li key={o.id}>
              <span>
                Order #{o.id.slice(0, 8)}
                {storeName(o.store_id) && <small>{storeName(o.store_id)}</small>}
              </span>
              <span>{money(o.total, currency)}</span>
            </li>
          ))}
        </ul>
        <div className="summary-row summary-total">
          <span>Total to pay</span>
          <strong>{money(total, currency)}</strong>
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Button asChild>
            <Link to="/account">View my orders</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/products">Keep shopping</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
