import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CatalogSkeleton, EmptyState } from "@/components/marketplace/shared";
import { SignOutButton } from "@/components/marketplace/auth-form";
import { ConfirmDialog, type ConfirmRequest } from "@/components/marketplace/confirm-dialog";
import { requireAuth } from "@/lib/auth";
import { money } from "@/services/catalog";
import { friendlyError } from "@/services/errors";
import {
  canCancel,
  formatAddress,
  lineAmounts,
  orderTotal,
  ordersService,
  type OrderWithItems,
} from "@/services/orders";

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
  const queryClient = useQueryClient();
  const key = ["orders", "mine", user.id];
  const orders = useQuery({ queryKey: key, queryFn: ordersService.getMyOrders });
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const cancel = useMutation({
    mutationFn: (o: OrderWithItems) => ordersService.cancelMyOrder(o.id),
    onSuccess: (_d, o) => toast.success(`Order #${o.id.slice(0, 8)} was cancelled`),
    onError: (e) =>
      toast.error(friendlyError(e, { "42501": "This order can no longer be cancelled." })),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ["orders"] }),
        queryClient.invalidateQueries({ queryKey: ["catalog"] }), // stock may be restored
      ]),
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
      <h2 id="my-orders" className="text-xl font-semibold mt-10 mb-4">
        My orders
      </h2>
      {orders.isPending ? (
        <CatalogSkeleton />
      ) : orders.isError ? (
        <div role="alert" className="seller-empty">
          <h3>Your orders could not be loaded.</h3>
          <p>{friendlyError(orders.error)}</p>
          <Button variant="outline" size="sm" onClick={() => orders.refetch()}>
            Try again
          </Button>
        </div>
      ) : !orders.data.length ? (
        <EmptyState
          title="No orders yet"
          description="When you place an order, it will appear here."
        />
      ) : (
        <ul className="order-list" aria-labelledby="my-orders">
          {orders.data.map((o) => {
            const busy = cancel.isPending && cancel.variables?.id === o.id;
            return (
              <li key={o.id} className="order-summary my-order">
                <div className="summary-row">
                  <span>
                    <strong>Order #{o.id.slice(0, 8)}</strong>
                    <small className="block text-muted-foreground">
                      {new Date(o.created_at).toLocaleString()}
                      {o.stores?.name && (
                        <>
                          {" · "}
                          <Link
                            to="/store/$slug"
                            params={{ slug: o.stores.slug }}
                            className="hover:underline"
                          >
                            {o.stores.name}
                          </Link>
                        </>
                      )}
                    </small>
                  </span>
                  <Badge variant={o.status === "cancelled" ? "outline" : "secondary"}>
                    {o.status}
                  </Badge>
                </div>
                <ul className="checkout-lines">
                  {o.order_items.map((i) => {
                    const { unit, line } = lineAmounts(i);
                    return (
                      <li key={i.id}>
                        <span>
                          {i.quantity} × {i.title ?? "Item"}
                          <small>{money(unit, o.currency)} each</small>
                        </span>
                        <span>{money(line, o.currency)}</span>
                      </li>
                    );
                  })}
                </ul>
                {formatAddress(o) && (
                  <p className="text-xs text-muted-foreground">Deliver to: {formatAddress(o)}</p>
                )}
                <div className="summary-row summary-total">
                  <span>
                    Total
                    {o.payment_provider === "cod" && (
                      <small className="block font-normal text-muted-foreground">
                        Pay on delivery
                      </small>
                    )}
                  </span>
                  <span>{money(orderTotal(o), o.currency)}</span>
                </div>
                {canCancel(o) && (
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        setConfirm({
                          title: `Cancel order #${o.id.slice(0, 8)}?`,
                          description:
                            "The store will be told not to send it. This can't be undone.",
                          confirmLabel: "Cancel order",
                          cancelLabel: "Keep order",
                          destructive: true,
                          run: () => cancel.mutateAsync(o),
                        })
                      }
                    >
                      {busy ? "Cancelling…" : "Cancel order"}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDialog request={confirm} busy={cancel.isPending} onClose={() => setConfirm(null)} />
    </main>
  );
}
