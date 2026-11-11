import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { StoreRow } from "@/data/db";
import { money } from "@/services/catalog";
import { formatAddress, lineAmounts, orderTotal } from "@/services/orders";
import {
  friendlyError,
  ORDER_STATUSES,
  sellerService,
  type OrderStatus,
  type SellerOrder,
} from "@/services/seller";
import { PanelState } from "./panel-state";

export function OrdersPanel({ stores }: { stores: StoreRow[] }) {
  const queryClient = useQueryClient();
  const storeIds = stores.map((s) => s.id);
  const key = ["seller", "orders", ...storeIds];
  const orders = useQuery({ queryKey: key, queryFn: () => sellerService.getOrders(storeIds) });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) =>
      sellerService.updateOrderStatus(id, status),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<SellerOrder[]>(key);
      queryClient.setQueryData<SellerOrder[]>(key, (list) =>
        list?.map((o) => (o.id === id ? { ...o, status } : o)),
      );
      return { previous };
    },
    onSuccess: (_d, { status }) => toast.success(`Order marked as ${status}`),
    onError: (e, _v, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous);
      toast.error(friendlyError(e));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const storeName = (id: string) => stores.find((s) => s.id === id)?.name ?? "";

  return (
    <section aria-labelledby="orders-heading">
      <div className="seller-panel-head">
        <div>
          <h2 id="orders-heading">Orders</h2>
          <p>Update the status as you fulfil each order.</p>
        </div>
      </div>
      <PanelState
        query={orders}
        errorText="Your orders could not be loaded."
        empty={{
          title: "No orders yet",
          description: "When shoppers buy from your store, their orders will appear here.",
        }}
      >
        {(list) => (
          <ul className="seller-list">
            {list.map((o) => {
              const options: string[] = ORDER_STATUSES.includes(o.status as OrderStatus)
                ? [...ORDER_STATUSES]
                : [o.status, ...ORDER_STATUSES];
              return (
                <li key={o.id} className="seller-row seller-order">
                  <div className="min-w-0 flex-1">
                    <h3 className="seller-row-title">
                      #{o.id.slice(0, 8)}
                      <span className="seller-row-meta">
                        {new Date(o.created_at).toLocaleString()}
                        {stores.length > 1 && <> · {storeName(o.store_id)}</>}
                      </span>
                    </h3>
                    <dl className="seller-order-customer">
                      <div>
                        <dt>Customer</dt>
                        <dd>{o.full_name || "—"}</dd>
                      </div>
                      <div>
                        <dt>Phone</dt>
                        <dd>
                          {o.phone ? (
                            <a href={`tel:${o.phone.replace(/[^\d+]/g, "")}`}>{o.phone}</a>
                          ) : (
                            "—"
                          )}
                        </dd>
                      </div>
                      <div className="wide">
                        <dt>Address</dt>
                        <dd>{formatAddress(o) || "—"}</dd>
                      </div>
                      {o.email && (
                        <div>
                          <dt>Email</dt>
                          <dd>{o.email}</dd>
                        </div>
                      )}
                      <div>
                        <dt>Payment</dt>
                        <dd>
                          {o.payment_provider === "cod"
                            ? "Pay on delivery"
                            : (o.payment_provider ?? "—")}
                          {o.payment_status && ` · ${o.payment_status}`}
                        </dd>
                      </div>
                      {o.notes && (
                        <div className="wide">
                          <dt>Notes</dt>
                          <dd>{o.notes}</dd>
                        </div>
                      )}
                    </dl>
                    <table className="seller-order-table">
                      <caption className="sr-only">Items in order {o.id.slice(0, 8)}</caption>
                      <thead>
                        <tr>
                          <th scope="col">Item</th>
                          <th scope="col">Qty</th>
                          <th scope="col">Price</th>
                          <th scope="col">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {o.order_items.map((i) => {
                          const { unit, line } = lineAmounts(i);
                          return (
                            <tr key={i.id}>
                              <td>{i.title ?? "Item"}</td>
                              <td>{i.quantity}</td>
                              <td>{money(unit, o.currency)}</td>
                              <td>{money(line, o.currency)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        {o.subtotal != null && Number(o.subtotal) !== orderTotal(o) && (
                          <tr>
                            <th scope="row" colSpan={3}>
                              Subtotal
                            </th>
                            <td>{money(Number(o.subtotal), o.currency)}</td>
                          </tr>
                        )}
                        <tr>
                          <th scope="row" colSpan={3}>
                            Order total
                          </th>
                          <td>
                            <strong>{money(orderTotal(o), o.currency)}</strong>
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <label className="seller-order-status">
                    <span className="sr-only">Status for order {o.id.slice(0, 8)}</span>
                    <select
                      className="seller-select"
                      value={o.status}
                      disabled={setStatus.isPending && setStatus.variables?.id === o.id}
                      onChange={(e) =>
                        setStatus.mutate({ id: o.id, status: e.target.value as OrderStatus })
                      }
                    >
                      {options.map((s) => (
                        <option
                          key={s}
                          value={s}
                          disabled={!ORDER_STATUSES.includes(s as OrderStatus)}
                        >
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </PanelState>
    </section>
  );
}
