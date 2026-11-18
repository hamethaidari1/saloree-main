import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { StoreRow } from "@/data/db";
import { money } from "@/services/catalog";
import { filterOrders, formatAddress, lineAmounts, orderTotal } from "@/services/orders";
import {
  friendlyError,
  ORDER_STATUSES,
  sellerService,
  type OrderStatus,
  type SellerOrder,
} from "@/services/seller";
import { isPaidOrCod } from "@/services/bulk-tracking";
import { orderPaymentState, type PaymentState } from "@/services/card-payment";
import { PanelState } from "./panel-state";
import { ShippingSection } from "./shipping-section";

const asNumber = (v: number | string | null | undefined) => (v == null ? null : Number(v));

/** Seller screens stay English. */
const PAYMENT_LABEL: Record<PaymentState, string> = {
  awaiting: "Awaiting payment",
  paid: "Paid",
  refunded: "Refunded",
  failed: "Payment failed",
  notCompleted: "Payment not completed — order cancelled",
  cod: "Pay on delivery",
};
const sellerPaymentLabel = (o: SellerOrder) => PAYMENT_LABEL[orderPaymentState(o)];
const METHOD_LABEL: Record<string, string> = { cod: "Pay on delivery", stripe: "Card (Stripe)" };
/** Online orders can't move to shipped/delivered until paid (the database enforces it too). */
const NEEDS_PAYMENT: readonly string[] = ["shipped", "delivered"];

function StatusSelect({
  order,
  disabled,
  onChange,
}: {
  order: SellerOrder;
  disabled: boolean;
  onChange: (status: OrderStatus) => void;
}) {
  const known = ORDER_STATUSES.includes(order.status as OrderStatus);
  const paid = isPaidOrCod(order);
  return (
    <label className="seller-order-status">
      <span className="sr-only">Status for order {order.id.slice(0, 8)}</span>
      <select
        className="seller-select"
        value={order.status}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as OrderStatus)}
      >
        {!known && (
          <option value={order.status} disabled>
            {order.status}
          </option>
        )}
        {ORDER_STATUSES.map((s) => {
          const blocked = !paid && NEEDS_PAYMENT.includes(s) && s !== order.status;
          return (
            <option key={s} value={s} disabled={blocked}>
              {blocked ? `${s} (awaiting payment)` : s}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-end">{children}</dd>
    </div>
  );
}

/** Everything about one order; the status is the only thing a seller can change. */
function OrderDetail({
  order,
  storeName,
  busy,
  onStatus,
  ordersKey,
}: {
  order: SellerOrder;
  storeName: string;
  busy: boolean;
  onStatus: (s: OrderStatus) => void;
  ordersKey: readonly unknown[];
}) {
  const cur = order.currency;
  const discount = asNumber(order.discount_amount) ?? 0;
  const commissionPct = asNumber(order.commission_percent);
  const commission = asNumber(order.commission_amount);
  const sellerAmount = asNumber(order.seller_amount);
  return (
    <div className="grid gap-5 px-5 pb-8">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {new Date(order.created_at).toLocaleString()}
          {storeName && ` · ${storeName}`}
        </span>
        <StatusSelect order={order} disabled={busy} onChange={onStatus} />
      </div>

      <section aria-labelledby="od-items">
        <h3 id="od-items" className="mb-1 font-semibold">
          Items
        </h3>
        <table className="seller-order-table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Qty</th>
              <th scope="col">Price</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {order.order_items.map((i) => {
              const { unit, line } = lineAmounts(i);
              return (
                <tr key={i.id}>
                  <td>
                    {i.title ?? "Item"}
                    {(i.selected_color || i.selected_size) && (
                      <span className="selected-options" data-testid="seller-item-options">
                        {[
                          i.selected_color && `Color: ${i.selected_color}`,
                          i.selected_size && `Size: ${i.selected_size}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </td>
                  <td>{i.quantity}</td>
                  <td>{money(unit, cur)}</td>
                  <td>{money(line, cur)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="od-money">
        <h3 id="od-money" className="mb-1 font-semibold">
          Payment
        </h3>
        <dl>
          {order.subtotal != null && (
            <Row label="Subtotal">{money(Number(order.subtotal), cur)}</Row>
          )}
          {discount > 0 && (
            <Row label={`Discount${order.discount_code ? ` (${order.discount_code})` : ""}`}>
              −{money(discount, cur)}
            </Row>
          )}
          <Row label="Order total">
            <strong>{money(orderTotal(order), cur)}</strong>
          </Row>
          {commission != null && (
            <Row
              label={`Platform commission${commissionPct != null ? ` (${commissionPct}%)` : ""}`}
            >
              −{money(commission, cur)}
            </Row>
          )}
          {sellerAmount != null && (
            <Row label="You receive">
              <strong>{money(sellerAmount, cur)}</strong>
            </Row>
          )}
          <Row label="Payment method">
            {METHOD_LABEL[order.payment_provider ?? "cod"] ?? order.payment_provider}
          </Row>
          <Row label="Payment status">{sellerPaymentLabel(order)}</Row>
        </dl>
        {!isPaidOrCod(order) && (
          <p className="seller-hint">Paid online: don't ship this order until it shows as Paid.</p>
        )}
      </section>

      <section aria-labelledby="od-customer">
        <h3 id="od-customer" className="mb-1 font-semibold">
          Customer
        </h3>
        <dl>
          <Row label="Name">{order.full_name || "—"}</Row>
          <Row label="Phone">
            {order.phone ? (
              <a className="text-primary" href={`tel:${order.phone.replace(/[^\d+]/g, "")}`}>
                {order.phone}
              </a>
            ) : (
              "—"
            )}
          </Row>
          <Row label="Email">{order.email || "—"}</Row>
          <Row label="Address">{formatAddress(order) || "—"}</Row>
          {order.notes && <Row label="Notes">{order.notes}</Row>}
        </dl>
      </section>

      <ShippingSection orderId={order.id} orderStatus={order.status} ordersKey={ordersKey} />
    </div>
  );
}

export function OrdersPanel({
  stores,
  status,
  query,
  onFiltersChange,
}: {
  stores: StoreRow[];
  status: string;
  query: string;
  onFiltersChange: (f: { status: string; query: string }) => void;
}) {
  const queryClient = useQueryClient();
  const storeIds = stores.map((s) => s.id);
  const key = ["seller", "orders", ...storeIds];
  const orders = useQuery({ queryKey: key, queryFn: () => sellerService.getOrders(storeIds) });
  const [openId, setOpenId] = useState<string | null>(null);

  const setStatus = useMutation({
    mutationFn: ({ id, status: s }: { id: string; status: OrderStatus }) =>
      sellerService.updateOrderStatus(id, s),
    onMutate: async ({ id, status: s }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<SellerOrder[]>(key);
      queryClient.setQueryData<SellerOrder[]>(key, (list) =>
        list?.map((o) => (o.id === id ? { ...o, status: s } : o)),
      );
      return { previous };
    },
    onSuccess: (_d, { status: s }) => toast.success(`Order marked as ${s}`),
    onError: (e, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous);
      toast.error(friendlyError(e));
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: key }),
        queryClient.invalidateQueries({ queryKey: ["seller", "pending-count"] }),
        queryClient.invalidateQueries({ queryKey: ["seller", "analytics"] }),
      ]),
  });
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "";
  const open = orders.data?.find((o) => o.id === openId) ?? null;
  const busyFor = (id: string) => setStatus.isPending && setStatus.variables?.id === id;

  return (
    <section aria-label="Orders">
      <div className="seller-filters" role="search" aria-label="Filter orders">
        <label className="seller-field">
          <span className="seller-label">Status</span>
          <select
            className="seller-select"
            value={status}
            onChange={(e) => onFiltersChange({ status: e.target.value, query })}
          >
            <option value="">All statuses</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="seller-field flex-1">
          <span className="seller-label">Search</span>
          <Input
            type="search"
            placeholder="Customer name or phone"
            value={query}
            onChange={(e) => onFiltersChange({ status, query: e.target.value })}
          />
        </label>
      </div>

      <PanelState
        query={orders}
        errorText="Your orders could not be loaded."
        empty={{
          title: "No orders yet",
          description: "When shoppers buy from your store, their orders will appear here.",
        }}
      >
        {(all) => {
          const list = filterOrders(all, { status, query });
          if (!list.length)
            return (
              <div className="seller-empty">
                <h3>No orders match these filters</h3>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onFiltersChange({ status: "", query: "" })}
                >
                  Clear filters
                </Button>
              </div>
            );
          return (
            <ul className="seller-list">
              {list.map((o) => {
                const discount = asNumber(o.discount_amount) ?? 0;
                return (
                  <li key={o.id} className="seller-row">
                    <div className="min-w-0 flex-1">
                      <h3 className="seller-row-title">
                        <button
                          type="button"
                          className="hover:underline focus-visible:underline"
                          onClick={() => setOpenId(o.id)}
                        >
                          #{o.id.slice(0, 8)}
                        </button>
                        <span className="seller-row-meta">
                          {new Date(o.created_at).toLocaleString()}
                        </span>
                      </h3>
                      <p className="seller-row-meta">
                        {o.full_name || "Customer"}
                        {o.phone && <> · {o.phone}</>}
                        <span aria-hidden>·</span>
                        {o.order_items.reduce((s, i) => s + i.quantity, 0)} items
                        {discount > 0 && (
                          <Badge variant="secondary">{o.discount_code ?? "Discount"}</Badge>
                        )}
                        {!isPaidOrCod(o) && (
                          <Badge variant="outline">{sellerPaymentLabel(o)}</Badge>
                        )}
                      </p>
                    </div>
                    <strong className="seller-order-total">
                      {money(orderTotal(o), o.currency)}
                    </strong>
                    <StatusSelect
                      order={o}
                      disabled={busyFor(o.id)}
                      onChange={(s) => setStatus.mutate({ id: o.id, status: s })}
                    />
                    <Button variant="outline" size="sm" onClick={() => setOpenId(o.id)}>
                      Details
                    </Button>
                  </li>
                );
              })}
            </ul>
          );
        }}
      </PanelState>

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpenId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-lg">
          <SheetHeader className="p-5 pe-12 text-start">
            <SheetTitle>Order #{open?.id.slice(0, 8)}</SheetTitle>
            <SheetDescription>Details, payment, customer and shipping.</SheetDescription>
          </SheetHeader>
          {open && (
            <OrderDetail
              order={open}
              storeName={stores.length > 1 ? storeName(open.store_id) : ""}
              busy={busyFor(open.id)}
              onStatus={(s) => setStatus.mutate({ id: open.id, status: s })}
              ordersKey={key}
            />
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}
