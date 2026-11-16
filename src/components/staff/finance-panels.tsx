import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PanelState } from "@/components/seller/panel-state";
import { QueryError, SalesChart, StatTile, TilesSkeleton } from "@/components/seller/stats";
import { ShipmentStatusBadge, ShipmentTimeline } from "@/components/tracking/tracking-ui";
import { adminKeys } from "@/components/admin/keys";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { money } from "@/services/catalog";
import { friendlyError } from "@/services/errors";
import {
  companyDetailsSchema,
  DEFAULT_INSTAGRAM_URL,
  DEFAULT_TIKTOK_URL,
  EMPTY_ORDER_FILTER,
  FINANCE_ORDER_LIMIT,
  FINANCE_PERIODS,
  filterFinanceOrders,
  financeService,
  INSTAGRAM_HOSTS,
  resolveSocialUrl,
  TIKTOK_HOSTS,
  type FinanceOrder,
  type FinanceOrderFilter,
  type FinancePeriod,
} from "@/services/finance";
import { lineAmounts, orderTotal, formatAddress } from "@/services/orders";
import { shippingService } from "@/services/shipping";
import { LoadError } from "./marketplace-panels";
import { InstagramIcon, TikTokIcon } from "@/components/marketplace/social-icons";

const count = new Intl.NumberFormat("en-US");
const usd = (n: number) => money(n, "USD");
const ORDER_STATUSES = ["pending", "processing", "shipped", "delivered", "cancelled"] as const;
const PAYMENT_STATUSES = ["pending", "paid", "failed", "refunded"] as const;
const PROVIDERS = ["cod", "stripe", "hesabpay", "paypal"] as const;
const PROVIDER_LABEL: Record<string, string> = {
  cod: "Cash on delivery",
  stripe: "Card (Stripe)",
  hesabpay: "HesabPay",
  paypal: "PayPal",
};

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
export function FinanceOverviewPanel() {
  const [days, setDays] = useState<FinancePeriod>(30);
  const q = useQuery({
    queryKey: [...adminKeys.all, "finance-overview", days],
    queryFn: () => financeService.overview(days),
    retry: false,
  });
  return (
    <section aria-labelledby="finance-overview-heading" className="grid gap-6">
      <div className="seller-panel-head">
        <div>
          <h2 id="finance-overview-heading">Money overview</h2>
          <p>All stores. Cancelled orders are left out of the totals.</p>
        </div>
        <div role="radiogroup" aria-label="Period" className="staff-segmented">
          {FINANCE_PERIODS.map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={days === d}
              className="staff-segment"
              onClick={() => setDays(d)}
            >
              {d} days
            </button>
          ))}
        </div>
      </div>
      {q.isPending ? (
        <TilesSkeleton count={8} />
      ) : q.isError ? (
        <QueryError query={q} title="The money overview could not be loaded." />
      ) : (
        <>
          <div className="admin-tiles">
            <StatTile label="Gross sales" value={usd(q.data.gross_sales)} />
            <StatTile label="Orders" value={count.format(q.data.orders_count)} />
            <StatTile
              label="Commission (earned)"
              value={usd(q.data.commission_total)}
              detail="Earned on these orders; see the note on cash on delivery."
            />
            <StatTile label="Owed to sellers" value={usd(q.data.seller_payable)} />
            <StatTile label="Discounts given" value={usd(q.data.discounts_given)} />
            <StatTile label="Paid online" value={usd(q.data.paid_amount)} />
            <StatTile label="Cash on delivery" value={usd(q.data.cod_amount)} />
            <StatTile label="Unpaid online" value={usd(q.data.unpaid_online_amount)} />
            <StatTile label="Cancelled orders" value={count.format(q.data.cancelled_count)} />
          </div>
          <p className="staff-note" role="note">
            <Info aria-hidden size={16} />
            Commission on cash-on-delivery orders is earned, not collected: the buyer pays the
            seller in cash, so Saloree has not received that money.
          </p>
          <SalesChart rows={q.data.by_day} title={`Sales per day — last ${q.data.days} days`} />
          <div className="staff-two-col">
            <section className="seller-card" aria-labelledby="top-stores-heading">
              <h3 id="top-stores-heading" className="mb-3 text-base font-semibold">
                Top stores
              </h3>
              {q.data.top_stores.length ? (
                <div className="staff-table-wrap">
                  <table className="seller-order-table">
                    <thead>
                      <tr>
                        <th scope="col">Store</th>
                        <th scope="col">Orders</th>
                        <th scope="col">Sales</th>
                        <th scope="col">Commission</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.top_stores.map((s) => (
                        <tr key={s.store_id}>
                          <td dir="auto">{s.name}</td>
                          <td>{count.format(s.orders)}</td>
                          <td>{usd(s.sales)}</td>
                          <td>{usd(s.commission)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="seller-hint">No sales in this period.</p>
              )}
            </section>
            <section className="seller-card" aria-labelledby="by-payment-heading">
              <h3 id="by-payment-heading" className="mb-3 text-base font-semibold">
                By payment
              </h3>
              {q.data.by_payment.length ? (
                <div className="staff-table-wrap">
                  <table className="seller-order-table">
                    <thead>
                      <tr>
                        <th scope="col">Method</th>
                        <th scope="col">Payment</th>
                        <th scope="col">Orders</th>
                        <th scope="col">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {q.data.by_payment.map((p) => (
                        <tr key={`${p.provider}|${p.payment_status}`}>
                          <td>{PROVIDER_LABEL[p.provider] ?? p.provider}</td>
                          <td>{p.payment_status}</td>
                          <td>{count.format(p.orders)}</td>
                          <td>{usd(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="seller-hint">No orders in this period.</p>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Orders (read only)
// ---------------------------------------------------------------------------
function OrderDrawer({ order, onClose }: { order: FinanceOrder | null; onClose: () => void }) {
  const items = useQuery({
    queryKey: [...adminKeys.orders, "items", order?.id ?? ""],
    queryFn: () => financeService.orderItems(order!.id),
    enabled: !!order,
  });
  const shipments = useQuery({
    queryKey: [...adminKeys.orders, "shipments", order?.id ?? ""],
    queryFn: () => shippingService.forOrders([order!.id]),
    enabled: !!order,
    retry: false,
  });
  const cur = order?.currency ?? "USD";
  return (
    <Sheet open={!!order} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="staff-drawer overflow-y-auto">
        {order && (
          <>
            <SheetHeader>
              <SheetTitle>Order #{order.id.slice(0, 8)}</SheetTitle>
              <SheetDescription>
                {order.stores?.name ?? "Unknown store"} ·{" "}
                {new Date(order.created_at).toLocaleString()}
              </SheetDescription>
            </SheetHeader>
            <p className="staff-note" role="note">
              <Info aria-hidden size={16} />
              Read only. Order status is changed by the store.
            </p>
            <dl className="staff-facts">
              <dt>Status</dt>
              <dd>{order.status}</dd>
              <dt>Customer</dt>
              <dd>
                {order.full_name ?? "—"}
                {order.phone && <bdi className="block">{order.phone}</bdi>}
                {order.email && <bdi className="block text-muted-foreground">{order.email}</bdi>}
              </dd>
              <dt>Deliver to</dt>
              <dd dir="auto">{formatAddress(order) || "—"}</dd>
              {order.notes && (
                <>
                  <dt>Notes</dt>
                  <dd dir="auto">{order.notes}</dd>
                </>
              )}
              <dt>Payment</dt>
              <dd>
                {PROVIDER_LABEL[order.payment_provider ?? "cod"] ?? order.payment_provider} ·{" "}
                {order.payment_status ?? "pending"}
                {order.paid_at && ` · paid ${new Date(order.paid_at).toLocaleString()}`}
              </dd>
              <dt>Total</dt>
              <dd>{money(orderTotal(order), cur)}</dd>
              {Number(order.discount_amount ?? 0) > 0 && (
                <>
                  <dt>Discount</dt>
                  <dd>
                    −{money(Number(order.discount_amount), cur)}
                    {order.discount_code && ` (${order.discount_code})`}
                  </dd>
                </>
              )}
              {Number(order.shipping_fee ?? 0) > 0 && (
                <>
                  <dt>Shipping fee</dt>
                  <dd>{money(Number(order.shipping_fee), cur)}</dd>
                </>
              )}
              <dt>Commission</dt>
              <dd>
                {money(Number(order.commission_amount ?? 0), cur)} (
                {Number(order.commission_percent ?? 0)}%)
              </dd>
              <dt>Seller receives</dt>
              <dd>{money(Number(order.seller_amount ?? 0), cur)}</dd>
            </dl>

            <h3 className="staff-subhead">Items</h3>
            {items.isPending ? (
              <div className="seller-skeleton" aria-busy="true" aria-label="Loading items">
                <div />
              </div>
            ) : items.isError ? (
              <p role="alert" className="seller-error">
                {friendlyError(items.error)}
              </p>
            ) : (
              <ul className="checkout-lines">
                {items.data.map((i) => {
                  const { unit, line } = lineAmounts(i);
                  return (
                    <li key={i.id}>
                      <span dir="auto">
                        {i.quantity} × {i.title ?? "Item"}
                        <small>{money(unit, cur)} each</small>
                      </span>
                      <span>{money(line, cur)}</span>
                    </li>
                  );
                })}
              </ul>
            )}

            <h3 className="staff-subhead">Shipments</h3>
            {shipments.isPending ? (
              <div className="seller-skeleton" aria-busy="true" aria-label="Loading shipments">
                <div />
              </div>
            ) : shipments.isError ? (
              <p role="alert" className="seller-error">
                {friendlyError(shipments.error)}
              </p>
            ) : !shipments.data.length ? (
              <p className="seller-hint">Not shipped yet.</p>
            ) : (
              <ul className="grid gap-4">
                {shipments.data.map((s) => (
                  <li key={s.id} className="grid gap-2">
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <strong>{s.carriers?.name ?? s.carrier_name ?? "Carrier"}</strong>
                      <bdi className="font-mono text-xs">{s.tracking_number}</bdi>
                      <ShipmentStatusBadge status={s.status} />
                    </p>
                    <ShipmentTimeline events={s.shipment_events} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function FinanceOrdersPanel() {
  const orders = useQuery({ queryKey: adminKeys.orders, queryFn: financeService.listOrders });
  const [filter, setFilter] = useState<FinanceOrderFilter>(EMPTY_ORDER_FILTER);
  const [open, setOpen] = useState<FinanceOrder | null>(null);
  const set = (k: keyof FinanceOrderFilter, v: string) => setFilter((f) => ({ ...f, [k]: v }));
  const stores = [
    ...new Map((orders.data ?? []).map((o) => [o.store_id, o.stores?.name ?? o.store_id])),
  ].sort((a, b) => a[1].localeCompare(b[1]));
  return (
    <section aria-labelledby="finance-orders-heading">
      <div className="seller-panel-head">
        <div>
          <h2 id="finance-orders-heading">Orders</h2>
          <p>Every order in every store. Read only.</p>
        </div>
      </div>
      <div className="staff-filters staff-filters-wrap" role="group" aria-label="Filter orders">
        <Input
          type="search"
          className="admin-search"
          placeholder="Customer name, phone or order id"
          aria-label="Search orders"
          value={filter.query}
          onChange={(e) => set("query", e.target.value)}
        />
        <select
          aria-label="Order status"
          className="staff-select"
          value={filter.status}
          onChange={(e) => set("status", e.target.value)}
        >
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          aria-label="Payment status"
          className="staff-select"
          value={filter.paymentStatus}
          onChange={(e) => set("paymentStatus", e.target.value)}
        >
          <option value="">Any payment status</option>
          {PAYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          aria-label="Payment method"
          className="staff-select"
          value={filter.provider}
          onChange={(e) => set("provider", e.target.value)}
        >
          <option value="">Any payment method</option>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {PROVIDER_LABEL[p]}
            </option>
          ))}
        </select>
        <select
          aria-label="Store"
          className="staff-select"
          value={filter.storeId}
          onChange={(e) => set("storeId", e.target.value)}
        >
          <option value="">All stores</option>
          {stores.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <label className="staff-date">
          From
          <Input type="date" value={filter.from} onChange={(e) => set("from", e.target.value)} />
        </label>
        <label className="staff-date">
          To
          <Input type="date" value={filter.to} onChange={(e) => set("to", e.target.value)} />
        </label>
        <Button variant="ghost" size="sm" onClick={() => setFilter(EMPTY_ORDER_FILTER)}>
          Clear
        </Button>
      </div>
      <PanelState
        query={orders}
        errorText="Orders could not be loaded."
        empty={{
          title: "No orders yet",
          description: "Orders appear here when customers check out.",
        }}
      >
        {(all) => {
          const list = filterFinanceOrders(all, filter);
          return (
            <>
              <p className="seller-hint mb-2">
                {count.format(list.length)} of {count.format(all.length)} orders
                {all.length >= FINANCE_ORDER_LIMIT &&
                  ` (showing the newest ${FINANCE_ORDER_LIMIT})`}
              </p>
              {!list.length ? (
                <p className="seller-hint">No orders match these filters.</p>
              ) : (
                <div className="staff-table-wrap">
                  <table className="seller-order-table staff-orders">
                    <thead>
                      <tr>
                        <th scope="col">Order</th>
                        <th scope="col">Date</th>
                        <th scope="col">Store</th>
                        <th scope="col">Customer</th>
                        <th scope="col">Status</th>
                        <th scope="col">Payment</th>
                        <th scope="col">Total</th>
                        <th scope="col">Commission</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((o) => (
                        <tr key={o.id}>
                          <td>
                            <button type="button" className="staff-link" onClick={() => setOpen(o)}>
                              #{o.id.slice(0, 8)}
                            </button>
                          </td>
                          <td>{new Date(o.created_at).toLocaleDateString()}</td>
                          <td dir="auto">{o.stores?.name ?? "—"}</td>
                          <td dir="auto">{o.full_name ?? "—"}</td>
                          <td>
                            <Badge variant={o.status === "cancelled" ? "outline" : "secondary"}>
                              {o.status}
                            </Badge>
                          </td>
                          <td>
                            {PROVIDER_LABEL[o.payment_provider ?? "cod"] ?? o.payment_provider} ·{" "}
                            {o.payment_status ?? "pending"}
                          </td>
                          <td>{money(orderTotal(o), o.currency)}</td>
                          <td>{money(Number(o.commission_amount ?? 0), o.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          );
        }}
      </PanelState>
      <OrderDrawer order={open} onClose={() => setOpen(null)} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Company details (site_settings.footer_settings only)
// ---------------------------------------------------------------------------
const COMPANY_FIELDS = [
  { key: "legal_name", label: "Legal name", max: 120 },
  { key: "business_id", label: "Business ID", max: 60 },
  { key: "address", label: "Address", max: 240, long: true },
  { key: "support_email", label: "Support email", max: 254, type: "email" },
  {
    key: "stripe_fees_text",
    label: "Card fees wording (legal pages)",
    max: 200,
    hint: 'Who pays the Stripe card fees, as it should read in the Seller Agreement, e.g. "paid by the seller" or "paid by Saloree". Not shown in the footer. While it is empty, the sentence that mentions it is hidden.',
  },
  {
    key: "instagram_url",
    label: "Instagram URL",
    max: 200,
    placeholder: DEFAULT_INSTAGRAM_URL,
    hint: 'Leave empty to use the default (https://www.instagram.com/saloreecom/). Enter a custom https://instagram.com URL, or check "Hide" / enter "hide" to hide the icon.',
    isSocial: true,
    socialName: "Instagram",
  },
  {
    key: "tiktok_url",
    label: "TikTok URL",
    max: 200,
    placeholder: DEFAULT_TIKTOK_URL,
    hint: 'Leave empty to use the default (https://www.tiktok.com/@saloree.com). Enter a custom https://tiktok.com URL, or check "Hide" / enter "hide" to hide the icon.',
    isSocial: true,
    socialName: "TikTok",
  },
] as const;
type CompanyKey = (typeof COMPANY_FIELDS)[number]["key"];

export function CompanyDetailsPanel() {
  const q = useQuery({
    queryKey: [...adminKeys.all, "company-details"],
    queryFn: financeService.getCompanyDetails,
    retry: false,
  });
  if (q.isPending)
    return (
      <div className="seller-skeleton" aria-busy="true" aria-label="Loading">
        <div />
      </div>
    );
  if (q.isError)
    return <LoadError what="The company details" error={q.error} retry={() => q.refetch()} />;
  return <CompanyForm key={q.dataUpdatedAt} initial={q.data} />;
}

function CompanyForm({ initial }: { initial: Record<CompanyKey, string> }) {
  const [values, setValues] = useState<Record<CompanyKey, string>>(() => ({
    legal_name: initial.legal_name,
    business_id: initial.business_id,
    address: initial.address,
    support_email: initial.support_email,
    stripe_fees_text: initial.stripe_fees_text,
    instagram_url: initial.instagram_url ?? "",
    tiktok_url: initial.tiktok_url ?? "",
  }));
  const [errors, setErrors] = useState<Partial<Record<CompanyKey, string>>>({});
  const save = useAdminAction(
    (v: Record<CompanyKey, string>) => financeService.saveCompanyDetails(v),
    {
      success: () => "Company details saved",
    },
  );
  const preview = [
    values.legal_name.trim(),
    values.business_id.trim() && `Business ID: ${values.business_id.trim()}`,
    values.address.trim(),
    values.support_email.trim() && `Support: ${values.support_email.trim()}`,
  ].filter(Boolean);

  const instagramPreview = resolveSocialUrl(
    values.instagram_url,
    DEFAULT_INSTAGRAM_URL,
    INSTAGRAM_HOSTS,
  );
  const tiktokPreview = resolveSocialUrl(
    values.tiktok_url,
    DEFAULT_TIKTOK_URL,
    TIKTOK_HOSTS,
  );

  return (
    <section className="staff-two-col">
      <form
        className="seller-form seller-card"
        noValidate
        aria-labelledby="company-heading"
        onSubmit={async (e) => {
          e.preventDefault();
          const parsed = companyDetailsSchema.safeParse(values);
          if (!parsed.success) {
            const fe = parsed.error.flatten().fieldErrors as Partial<Record<CompanyKey, string[]>>;
            return setErrors(
              Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? ""])) as Partial<
                Record<CompanyKey, string>
              >,
            );
          }
          setErrors({});
          await save.mutateAsync(values).catch(() => {});
        }}
      >
        <h2 id="company-heading" className="text-base font-semibold">
          Company details
        </h2>
        <p className="seller-hint">
          Shown in the site footer and used in the legal pages. Only these details are changed;
          other footer settings are kept. Leave a field empty to hide it.
        </p>
        {COMPANY_FIELDS.map((f) => {
          const id = `company-${f.key}`;
          const isSocial = "isSocial" in f && f.isSocial;
          const common = {
            id,
            value: values[f.key],
            maxLength: f.max,
            "aria-invalid": !!errors[f.key],
            placeholder: "placeholder" in f ? f.placeholder : undefined,
            onChange: (e: { target: { value: string } }) =>
              setValues((v) => ({ ...v, [f.key]: e.target.value })),
          };
          return (
            <div key={f.key} className="seller-field">
              <Label htmlFor={id}>{f.label}</Label>
              {"long" in f ? (
                <Textarea rows={2} {...common} />
              ) : (
                <Input
                  type={"type" in f ? f.type : "text"}
                  {...common}
                  {...("hint" in f ? { "aria-describedby": `${id}-hint` } : {})}
                />
              )}
              {isSocial && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground mt-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={values[f.key]?.trim().toLowerCase() === "hide"}
                    onChange={(e) =>
                      setValues((v) => ({
                        ...v,
                        [f.key]: e.target.checked ? "hide" : "",
                      }))
                    }
                  />
                  <span>Hide {f.socialName} icon from footer</span>
                </label>
              )}
              {"hint" in f && (
                <p id={`${id}-hint`} className="seller-hint">
                  {f.hint}
                </p>
              )}
              {errors[f.key] && <p className="seller-error">{errors[f.key]}</p>}
            </div>
          );
        })}
        <div>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save company details"}
          </Button>
        </div>
      </form>
      <section className="seller-card" aria-labelledby="company-preview-heading">
        <h3 id="company-preview-heading" className="mb-3 text-base font-semibold">
          Footer preview
        </h3>
        <div className="staff-footer-preview flex flex-col items-center gap-3">
          {(instagramPreview || tiktokPreview) && (
            <div
              className="staff-preview-social flex flex-col items-center gap-1.5 pb-2 border-b border-border/40 w-full"
              data-testid="admin-footer-preview-social"
            >
              <span className="text-xs font-semibold text-foreground">Follow Saloree</span>
              <div className="flex items-center gap-2">
                {instagramPreview && (
                  <span
                    className="footer-social-link"
                    data-testid="admin-preview-instagram"
                    title={`Instagram: ${instagramPreview}`}
                  >
                    <InstagramIcon />
                  </span>
                )}
                {tiktokPreview && (
                  <span
                    className="footer-social-link"
                    data-testid="admin-preview-tiktok"
                    title={`TikTok: ${tiktokPreview}`}
                  >
                    <TikTokIcon />
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
            {preview.length ? (
              preview.map((line) => (
                <span key={line} dir="auto">
                  {line}
                </span>
              ))
            ) : (
              <span>Nothing is shown when all fields are empty.</span>
            )}
          </div>
        </div>
      </section>
    </section>
  );
}
