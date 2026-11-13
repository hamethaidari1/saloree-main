import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { PanelState } from "@/components/seller/panel-state";
import { useSeller } from "@/components/seller/seller-context";
import { SellerPageHeader } from "@/components/seller/seller-shell";
import { money } from "@/services/catalog";
import { lineAmounts, orderTotal } from "@/services/orders";
import { sellerDashboardService, type SellerCustomer } from "@/services/seller-dashboard";
import { searchCustomers, sortCustomers, type CustomerSort } from "@/services/customers";

export const Route = createFileRoute("/seller/customers")({
  ssr: false,
  pendingComponent: CatalogSkeleton,
  component: CustomersPage,
});

const COLUMNS: { key: CustomerSort["key"]; label: string; numeric?: boolean }[] = [
  { key: "full_name", label: "Customer" },
  { key: "orders_count", label: "Orders", numeric: true },
  { key: "total_spent", label: "Total spent", numeric: true },
  { key: "last_order_at", label: "Last order", numeric: true },
];

function CustomerOrders({ customer }: { customer: SellerCustomer }) {
  const { stores } = useSeller();
  const storeIds = stores.map((s) => s.id);
  const orders = useQuery({
    queryKey: ["seller", "customer-orders", customer.customer_id, ...storeIds],
    queryFn: () => sellerDashboardService.customerOrders(customer.customer_id, storeIds),
  });
  return (
    <div className="grid gap-4 px-5 pb-8">
      <dl className="grid gap-1 text-sm">
        {customer.email && (
          <div>
            <dt className="sr-only">Email</dt>
            <dd>{customer.email}</dd>
          </div>
        )}
        {customer.phone && (
          <div>
            <dt className="sr-only">Phone</dt>
            <dd>
              <a className="text-primary" href={`tel:${customer.phone.replace(/[^\d+]/g, "")}`}>
                {customer.phone}
              </a>
            </dd>
          </div>
        )}
        {(customer.city || customer.country) && (
          <div>
            <dt className="sr-only">Location</dt>
            <dd className="text-muted-foreground">
              {[customer.city, customer.country].filter(Boolean).join(", ")}
            </dd>
          </div>
        )}
      </dl>
      <h3 className="font-semibold">Orders from your store</h3>
      <PanelState
        query={orders}
        errorText="Their orders could not be loaded."
        empty={{ title: "No orders found", description: "This customer has no orders here." }}
      >
        {(list) => (
          <ul className="grid gap-3">
            {list.map((o) => (
              <li key={o.id} className="order-summary">
                <div className="summary-row">
                  <strong>#{o.id.slice(0, 8)}</strong>
                  <Badge variant="secondary">{o.status}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(o.created_at).toLocaleString()}
                  {stores.length > 1 && o.stores?.name && ` · ${o.stores.name}`}
                </p>
                <ul className="checkout-lines">
                  {o.order_items.map((i) => (
                    <li key={i.id}>
                      <span>
                        {i.quantity} × {i.title ?? "Item"}
                      </span>
                      <span>{money(lineAmounts(i).line, o.currency)}</span>
                    </li>
                  ))}
                </ul>
                <div className="summary-row summary-total">
                  <span>Total</span>
                  <span>{money(orderTotal(o), o.currency)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PanelState>
    </div>
  );
}

function CustomersPage() {
  const customers = useQuery({
    queryKey: ["seller", "customers"],
    queryFn: sellerDashboardService.customers,
  });
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CustomerSort>({ key: "last_order_at", dir: "desc" });
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = useMemo(
    () => sortCustomers(searchCustomers(customers.data ?? [], search), sort),
    [customers.data, search, sort],
  );
  const open = customers.data?.find((c) => c.customer_id === openId) ?? null;

  return (
    <div className="seller-page">
      <SellerPageHeader
        title="Customers"
        description="People who have ordered from your stores."
        actions={
          <Input
            type="search"
            className="admin-search"
            placeholder="Search name, email or phone"
            aria-label="Search customers"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        }
      />
      <PanelState
        query={customers}
        errorText="Your customers could not be loaded."
        empty={{
          title: "No customers yet",
          description: "Customers appear here after their first order from your store.",
        }}
      >
        {() =>
          !rows.length ? (
            <p className="seller-hint">No customers match “{search}”.</p>
          ) : (
            <div className="seller-card overflow-x-auto p-0">
              <table className="seller-table">
                <thead>
                  <tr>
                    {COLUMNS.map((c) => {
                      const active = sort.key === c.key;
                      return (
                        <th
                          key={c.key}
                          scope="col"
                          aria-sort={
                            active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
                          }
                          className={c.numeric ? "text-end" : undefined}
                        >
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 hover:underline"
                            onClick={() =>
                              setSort((s) => ({
                                key: c.key,
                                dir: s.key === c.key && s.dir === "desc" ? "asc" : "desc",
                              }))
                            }
                          >
                            {c.label}
                            {active &&
                              (sort.dir === "asc" ? (
                                <ArrowUp size={13} aria-hidden />
                              ) : (
                                <ArrowDown size={13} aria-hidden />
                              ))}
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.customer_id}>
                      <td>
                        <button
                          type="button"
                          className="text-start hover:underline"
                          onClick={() => setOpenId(c.customer_id)}
                        >
                          <span className="block font-medium">
                            {c.full_name || c.email || "Customer"}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {[c.email, c.phone].filter(Boolean).join(" · ")}
                          </span>
                        </button>
                      </td>
                      <td className="text-end">{c.orders_count}</td>
                      <td className="text-end">{money(c.total_spent)}</td>
                      <td className="text-end">
                        {c.last_order_at ? new Date(c.last_order_at).toLocaleDateString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </PanelState>

      <Sheet open={!!open} onOpenChange={(v) => !v && setOpenId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-lg">
          <SheetHeader className="p-5 pe-12 text-start">
            <SheetTitle>{open?.full_name || open?.email || "Customer"}</SheetTitle>
            <SheetDescription>
              {open &&
                `${open.orders_count} order${open.orders_count === 1 ? "" : "s"} · ${money(open.total_spent)} spent`}
            </SheetDescription>
          </SheetHeader>
          {open && <CustomerOrders customer={open} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}
