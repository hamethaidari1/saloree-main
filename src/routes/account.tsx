import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CatalogSkeleton, EmptyState } from "@/components/marketplace/shared";
import { SignOutButton } from "@/components/marketplace/auth-form";
import { requireAuth } from "@/lib/auth";
import { money } from "@/services/catalog";
import { orderTotal, ordersService } from "@/services/orders";

export const Route = createFileRoute("/account")({
  ssr: false,
  beforeLoad: requireAuth(),
  head: () => ({
    meta: [{ title: "Your account — Saloree" }, { name: "robots", content: "noindex" }],
  }),
  pendingComponent: CatalogSkeleton,
  component: AccountPage,
});

function AccountPage() {
  const { user } = Route.useRouteContext();
  const orders = useQuery({
    queryKey: ["orders", "mine", user.id],
    queryFn: ordersService.getMyOrders,
  });
  return (
    <main className="market-container pb-16">
      <div className="account-header">
        <div>
          <h1 className="page-title">Your account</h1>
          <p className="page-subtitle">{user.email}</p>
        </div>
        <SignOutButton />
      </div>
      <h2 className="text-xl font-semibold mt-10 mb-4">Your orders</h2>
      {orders.isPending ? (
        <CatalogSkeleton />
      ) : orders.isError ? (
        <p role="alert" className="auth-error">
          Your orders could not be loaded.
        </p>
      ) : !orders.data.length ? (
        <EmptyState
          title="No orders yet"
          description="When you place an order, it will appear here."
        />
      ) : (
        <ul className="order-list">
          {orders.data.map((o) => (
            <li key={o.id} className="order-summary">
              <div className="summary-row">
                <strong>{new Date(o.created_at).toLocaleDateString()}</strong>
                <span>{o.status}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {o.order_items.map((i) => `${i.quantity} × ${i.title ?? "Item"}`).join(", ")}
              </p>
              <div className="summary-row summary-total">
                <span>Total</span>
                <span>{money(orderTotal(o))}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
