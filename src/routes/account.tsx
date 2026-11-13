import { useTranslation } from "react-i18next";
import { headT } from "@/i18n/head";
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
import { CustomerTracking } from "@/components/tracking/customer-tracking";
import { shippingService } from "@/services/shipping";
import { useFormat } from "@/i18n/hooks";
import { translateError } from "@/i18n/messages";
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
  head: ({ matches }) => ({
    meta: [
      { title: headT(matches, "account")("metaTitle") },
      { name: "robots", content: "noindex" },
    ],
  }),
  pendingComponent: CatalogSkeleton,
  component: AccountPage,
});

function AccountPage() {
  const { t } = useTranslation("account");
  const format = useFormat();
  const { user } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const key = ["orders", "mine", user.id];
  const orders = useQuery({ queryKey: key, queryFn: ordersService.getMyOrders });
  // Loaded separately so My orders still works if tracking isn't available.
  const orderIds = (orders.data ?? []).map((o) => o.id);
  const shipments = useQuery({
    queryKey: ["shipments", "orders", ...orderIds],
    queryFn: () => shippingService.forOrders(orderIds),
    enabled: orderIds.length > 0,
    retry: false,
  });
  const shipmentsFor = (orderId: string) =>
    (shipments.data ?? []).filter((s) => s.order_id === orderId);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const cancel = useMutation({
    mutationFn: (o: OrderWithItems) => ordersService.cancelMyOrder(o.id),
    onSuccess: (_d, o) => toast.success(t("cancelled", { id: o.id.slice(0, 8) })),
    onError: (e) => toast.error(translateError(t, e, { "42501": "orders.cannotCancel" })),
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
          <h1 className="page-title">{t("title")}</h1>
          <p className="page-subtitle">
            <bdi>{user.email}</bdi>
          </p>
        </div>
        <SignOutButton />
      </div>
      <h2 id="my-orders" className="text-xl font-semibold mt-10 mb-4">
        {t("myOrders")}
      </h2>
      {orders.isPending ? (
        <CatalogSkeleton />
      ) : orders.isError ? (
        <div role="alert" className="seller-empty">
          <h3>{t("loadError")}</h3>
          <p>{translateError(t, orders.error)}</p>
          <Button variant="outline" size="sm" onClick={() => orders.refetch()}>
            {t("tryAgain", { ns: "common" })}
          </Button>
        </div>
      ) : !orders.data.length ? (
        <EmptyState title={t("emptyTitle")} description={t("emptyText")} />
      ) : (
        <ul className="order-list" aria-labelledby="my-orders">
          {orders.data.map((o) => {
            const busy = cancel.isPending && cancel.variables?.id === o.id;
            return (
              <li key={o.id} className="order-summary my-order">
                <div className="summary-row">
                  <span>
                    <strong>{t("orderNumber", { id: o.id.slice(0, 8) })}</strong>
                    <small className="block text-muted-foreground">
                      {format.dateTime(o.created_at)}
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
                    {t(`status.${o.status}`, { ns: "orders", defaultValue: o.status })}
                  </Badge>
                </div>
                <ul className="checkout-lines">
                  {o.order_items.map((i) => {
                    const { unit, line } = lineAmounts(i);
                    return (
                      <li key={i.id}>
                        <span>
                          {t("line", {
                            quantity: format.number(i.quantity),
                            title: i.title ?? t("itemFallback"),
                          })}
                          <small>{t("each", { price: format.price(unit, o.currency) })}</small>
                        </span>
                        <span>{format.price(line, o.currency)}</span>
                      </li>
                    );
                  })}
                </ul>
                {formatAddress(o) && (
                  <p className="text-xs text-muted-foreground" dir="auto">
                    {t("deliverTo", { address: formatAddress(o) })}
                  </p>
                )}
                <CustomerTracking
                  orderStatus={o.status}
                  shipments={shipmentsFor(o.id)}
                  loading={shipments.isPending && shipments.fetchStatus !== "idle"}
                  error={shipments.error}
                />
                {Number(o.discount_amount ?? 0) > 0 && (
                  <div className="summary-row">
                    <span>
                      {o.discount_code
                        ? t("discountWithCode", { code: o.discount_code })
                        : t("discount")}
                    </span>
                    <span>−{format.price(Number(o.discount_amount), o.currency)}</span>
                  </div>
                )}
                <div className="summary-row summary-total">
                  <span>
                    {t("total")}
                    {o.payment_provider === "cod" && (
                      <small className="block font-normal text-muted-foreground">
                        {t("payOnDelivery")}
                      </small>
                    )}
                  </span>
                  <span>{format.price(orderTotal(o), o.currency)}</span>
                </div>
                {canCancel(o) && (
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        setConfirm({
                          title: t("cancelTitle", { id: o.id.slice(0, 8) }),
                          description: t("cancelText"),
                          confirmLabel: t("cancelOrder"),
                          cancelLabel: t("keepOrder"),
                          destructive: true,
                          run: () => cancel.mutateAsync(o),
                        })
                      }
                    >
                      {busy ? t("cancelling") : t("cancelOrder")}
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
