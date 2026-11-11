import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { PanelState } from "@/components/seller/panel-state";
import { adminService } from "@/services/admin";
import { money } from "@/services/catalog";
import { orderTotal } from "@/services/orders";
import { adminKeys } from "./keys";

/** Read-only: admins see every order but status is changed by sellers. */
export function OrdersPanel() {
  const orders = useQuery({ queryKey: adminKeys.orders, queryFn: adminService.listOrders });
  return (
    <section aria-labelledby="admin-orders-heading">
      <div className="seller-panel-head">
        <div>
          <h2 id="admin-orders-heading">Orders</h2>
          <p>All orders across the marketplace (read-only).</p>
        </div>
      </div>
      <PanelState
        query={orders}
        errorText="Orders could not be loaded."
        empty={{
          title: "No orders yet",
          description: "Orders appear here once shoppers check out.",
        }}
      >
        {(list) => (
          <ul className="seller-list">
            {list.map((o) => (
              <li key={o.id} className="seller-row">
                <div className="min-w-0 flex-1">
                  <h3 className="seller-row-title">
                    #{o.id.slice(0, 8)}
                    <span className="seller-row-meta">
                      {new Date(o.created_at).toLocaleString()}
                    </span>
                  </h3>
                  <p className="seller-row-meta">
                    {o.stores?.name ?? "Unknown store"}
                    {o.email && (
                      <>
                        <span aria-hidden>·</span>
                        {o.email}
                      </>
                    )}
                  </p>
                </div>
                <Badge variant="secondary">{o.status}</Badge>
                <strong className="seller-order-total">{money(orderTotal(o))}</strong>
              </li>
            ))}
          </ul>
        )}
      </PanelState>
    </section>
  );
}
