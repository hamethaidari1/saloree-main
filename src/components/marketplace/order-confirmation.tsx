import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CatalogSkeleton, EmptyState, useCatalog } from "@/components/marketplace/shared";
import { CustomerTracking } from "@/components/tracking/customer-tracking";
import { useFormat } from "@/i18n/hooks";
import { checkoutService } from "@/services/checkout";
import { ordersService } from "@/services/orders";
import { shippingService } from "@/services/shipping";

/** Live delivery status for each order of this checkout. */
function ConfirmationTracking({ orders }: { orders: { id: string; label: string }[] }) {
  const { t } = useTranslation("orders");
  const ids = orders.map((o) => o.id);
  const statuses = useQuery({
    queryKey: ["orders", "statuses", ...ids],
    queryFn: () => ordersService.getStatuses(ids),
  });
  const shipments = useQuery({
    queryKey: ["shipments", "orders", ...ids],
    queryFn: () => shippingService.forOrders(ids),
    retry: false,
  });
  return (
    <section className="mt-6 grid gap-4" aria-labelledby="confirm-tracking">
      <h2 id="confirm-tracking" className="text-base font-semibold">
        {t("confirmation.delivery")}
      </h2>
      {orders.map((o) => (
        <div key={o.id} className="grid gap-2">
          {orders.length > 1 && <p className="text-sm font-medium">{o.label}</p>}
          <CustomerTracking
            orderStatus={statuses.data?.[o.id] ?? ""}
            shipments={(shipments.data ?? []).filter((s) => s.order_id === o.id)}
            loading={statuses.isPending || shipments.isPending}
            error={statuses.error ?? shipments.error}
          />
        </div>
      ))}
    </section>
  );
}

/** The confirmation of one checkout (all its orders), from the saved server values. */
export function OrderConfirmation({ groupId }: { groupId: string }) {
  const { t } = useTranslation("orders");
  const format = useFormat();
  const { stores } = useCatalog();
  // Right after checkout this is the place_order result (seeded into the cache);
  // after a reload it is rebuilt from the saved orders.
  const result = useQuery({
    queryKey: ["checkout", groupId],
    queryFn: () => checkoutService.getCheckoutGroup(groupId),
    staleTime: Infinity,
  });

  if (result.isPending) return <CatalogSkeleton />;
  if (result.isError || !result.data) return <ConfirmationNotFound />;

  const { total, currency, orders, discount_total, payment_provider } = result.data;
  const card = payment_provider === "stripe";
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name;
  return (
    <main className="market-container auth-page">
      <section className="auth-card confirmation" aria-labelledby="confirm-heading">
        <CircleCheck className="mx-auto text-primary" size={40} aria-hidden />
        <h1 id="confirm-heading" className="page-title text-center">
          {t("confirmation.title")}
        </h1>
        <p className="page-subtitle text-center">
          {card ? t("confirmation.subtitlePaid") : t("confirmation.subtitle")}
        </p>
        <ul className="checkout-lines mt-6">
          {orders.map((o) => (
            <li key={o.id}>
              <span>
                {t("confirmation.orderNumber", { id: o.id.slice(0, 8) })}
                {storeName(o.store_id) && <small>{storeName(o.store_id)}</small>}
                {o.discount > 0 && (
                  <small>
                    {t("confirmation.discount", { amount: format.price(o.discount, currency) })}
                  </small>
                )}
              </span>
              <span>{format.price(o.total, currency)}</span>
            </li>
          ))}
        </ul>
        {discount_total > 0 && (
          <div className="summary-row">
            <span>{t("confirmation.saved")}</span>
            <span>−{format.price(discount_total, currency)}</span>
          </div>
        )}
        <div className="summary-row summary-total">
          <span>{card ? t("confirmation.totalPaid") : t("confirmation.totalToPay")}</span>
          <strong>{format.price(total, currency)}</strong>
        </div>
        <ConfirmationTracking
          orders={orders.map((o) => ({
            id: o.id,
            label: storeName(o.store_id) ?? t("confirmation.orderNumber", { id: o.id.slice(0, 8) }),
          }))}
        />
        <ConfirmationLinks />
      </section>
    </main>
  );
}

export function ConfirmationNotFound() {
  const { t } = useTranslation("orders");
  return (
    <main className="market-container">
      <EmptyState
        title={t("confirmation.notFoundTitle")}
        description={t("confirmation.notFoundText")}
      />
    </main>
  );
}

export function ConfirmationLinks() {
  const { t } = useTranslation("orders");
  return (
    <div className="mt-6 flex flex-wrap justify-center gap-2">
      <Button asChild>
        <Link to="/account">{t("confirmation.viewOrders")}</Link>
      </Button>
      <Button asChild variant="outline">
        <Link to="/products">{t("confirmation.keepShopping")}</Link>
      </Button>
    </div>
  );
}
