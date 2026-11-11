import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Lock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCart } from "@/components/marketplace/cart-context";
import { CatalogSkeleton, EmptyState, useCatalog } from "@/components/marketplace/shared";
import { requireAuth } from "@/lib/auth";
import { cartTotal } from "@/services/cart";
import { money } from "@/services/catalog";
import {
  checkoutCustomerSchema,
  checkoutService,
  PAYMENT_METHODS,
  type CheckoutCustomerInput,
  type PaymentProvider,
} from "@/services/checkout";
import { friendlyError } from "@/services/errors";

export const Route = createFileRoute("/checkout")({
  ssr: false,
  beforeLoad: requireAuth(),
  head: () => ({
    meta: [{ title: "Checkout — Saloree" }, { name: "robots", content: "noindex" }],
  }),
  pendingComponent: CatalogSkeleton,
  component: CheckoutPage,
});

type Field = keyof CheckoutCustomerInput;
const FIELDS: { key: Field; label: string; autoComplete: string; type?: string; wide?: boolean }[] =
  [
    { key: "full_name", label: "Full name", autoComplete: "name" },
    { key: "phone", label: "Phone", autoComplete: "tel", type: "tel" },
    { key: "email", label: "Email", autoComplete: "email", type: "email", wide: true },
    { key: "country", label: "Country", autoComplete: "country-name" },
    { key: "city", label: "City", autoComplete: "address-level2" },
    { key: "address", label: "Street address", autoComplete: "street-address", wide: true },
  ];

function CheckoutPage() {
  const { user } = Route.useRouteContext();
  const { items, ready, clear } = useCart();
  const { products, stores } = useCatalog();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<Field, string>>({
    full_name: String(user.user_metadata?.["full_name"] ?? ""),
    phone: "",
    email: user.email ?? "",
    country: "",
    city: "",
    address: "",
    notes: "",
  });
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [provider, setProvider] = useState<PaymentProvider>("cod");

  const place = useMutation({
    mutationFn: () => checkoutService.placeOrder(items, values, provider),
    onSuccess: async (result) => {
      queryClient.setQueryData(["checkout", result.checkout_group_id], result);
      await navigate({
        to: "/order-confirmation/$groupId",
        params: { groupId: result.checkout_group_id },
        replace: true,
      });
      clear();
      void queryClient.invalidateQueries({ queryKey: ["orders"] });
      void queryClient.invalidateQueries({ queryKey: ["catalog"] }); // stock changed
    },
    onError: (e) =>
      toast.error(friendlyError(e, { "42501": "Please sign in again to place your order." })),
  });

  if (!ready) return <CatalogSkeleton />;
  if (!items.length)
    return (
      <main className="market-container">
        <EmptyState
          title="Your bag is empty"
          description="Add something you love, then come back to check out."
        />
      </main>
    );

  const lines = items.flatMap((i) => {
    const p = products.find((x) => x.id === i.productId);
    return p ? [{ ...i, product: p, store: stores.find((s) => s.slug === p.storeSlug) }] : [];
  });
  const estimate = cartTotal(items, products);

  return (
    <main className="market-container pb-16">
      <div className="breadcrumb">
        <Link to="/cart">Your bag</Link>
        <ChevronRight />
        <span>Checkout</span>
      </div>
      <h1 className="page-title">Checkout</h1>
      <p className="page-subtitle">Where should we send your finds?</p>
      <form
        className="cart-layout"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (place.isPending) return;
          const parsed = checkoutCustomerSchema.safeParse(values);
          if (!parsed.success) {
            const fe = parsed.error.flatten().fieldErrors;
            setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0]])));
            document.getElementById(`checkout-${Object.keys(fe)[0]}`)?.focus();
            return;
          }
          setErrors({});
          place.mutate();
        }}
      >
        <div className="seller-form">
          <fieldset className="seller-form-row" disabled={place.isPending}>
            <legend className="checkout-legend">Delivery details</legend>
            {FIELDS.map((f) => (
              <div key={f.key} className={`seller-field ${f.wide ? "checkout-wide" : ""}`}>
                <Label htmlFor={`checkout-${f.key}`}>{f.label}</Label>
                <Input
                  id={`checkout-${f.key}`}
                  type={f.type ?? "text"}
                  autoComplete={f.autoComplete}
                  value={values[f.key]}
                  aria-invalid={!!errors[f.key]}
                  aria-describedby={errors[f.key] ? `checkout-${f.key}-error` : undefined}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  required
                />
                {errors[f.key] && (
                  <p id={`checkout-${f.key}-error`} className="seller-error">
                    {errors[f.key]}
                  </p>
                )}
              </div>
            ))}
            <div className="seller-field checkout-wide">
              <Label htmlFor="checkout-notes">Delivery notes (optional)</Label>
              <Textarea
                id="checkout-notes"
                rows={3}
                maxLength={500}
                value={values.notes}
                onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
              />
              {errors.notes && <p className="seller-error">{errors.notes}</p>}
            </div>
          </fieldset>

          <fieldset className="checkout-payments" disabled={place.isPending}>
            <legend className="checkout-legend">Payment</legend>
            {PAYMENT_METHODS.map((m) => (
              <label
                key={m.id}
                className={`checkout-payment ${provider === m.id ? "selected" : ""} ${m.enabled ? "" : "disabled"}`}
              >
                <input
                  type="radio"
                  name="payment"
                  value={m.id}
                  disabled={!m.enabled}
                  checked={provider === m.id}
                  onChange={() => m.enabled && setProvider(m.id)}
                />
                <span>
                  <strong>{m.label}</strong>
                  <small>{m.description}</small>
                </span>
              </label>
            ))}
          </fieldset>
        </div>

        <aside className="order-summary">
          <h2>Your order</h2>
          <ul className="checkout-lines">
            {lines.map((l) => (
              <li key={l.productId}>
                <span className="min-w-0">
                  {l.quantity} × {l.product.title}
                  <small>{l.store?.name}</small>
                </span>
                <span>{money(l.product.price * l.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="summary-row summary-total">
            <span>Estimated total</span>
            <span>{money(estimate)}</span>
          </div>
          <p className="checkout-note">
            Prices, stock and shipping are confirmed by Saloree when you place the order. Items from
            different stores become separate orders.
          </p>
          <Button type="submit" className="w-full h-11 mt-4" disabled={place.isPending}>
            <Lock />
            {place.isPending ? "Placing your order…" : "Place order"}
          </Button>
        </aside>
      </form>
    </main>
  );
}
