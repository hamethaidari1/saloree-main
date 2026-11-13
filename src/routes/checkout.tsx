import { useTranslation } from "react-i18next";
import { headT } from "@/i18n/head";
import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useFormat, useLocale } from "@/i18n/hooks";
import { codPausedStores, isCodPausedError } from "@/services/payouts";
import { translateError, validationMessage } from "@/i18n/messages";
import {
  checkoutCustomerSchema,
  checkoutService,
  codRule,
  discountCodeSchema,
  isInvalidDiscountError,
  PAYMENT_METHODS,
  type CheckoutCustomerInput,
  type PaymentProvider,
} from "@/services/checkout";

export const Route = createFileRoute("/checkout")({
  ssr: false,
  beforeLoad: requireAuth(),
  head: ({ matches }) => ({
    meta: [
      { title: headT(matches, "checkout")("metaTitle") },
      { name: "robots", content: "noindex" },
    ],
  }),
  pendingComponent: CatalogSkeleton,
  component: CheckoutPage,
});

type Field = keyof CheckoutCustomerInput;
/** Labels come from checkout:fields.<key>. */
const FIELDS: { key: Field; autoComplete: string; type?: string; wide?: boolean }[] = [
  { key: "full_name", autoComplete: "name" },
  { key: "phone", autoComplete: "tel", type: "tel" },
  { key: "email", autoComplete: "email", type: "email", wide: true },
  { key: "country", autoComplete: "country-name" },
  { key: "city", autoComplete: "address-level2" },
  { key: "address", autoComplete: "street-address", wide: true },
];

function CheckoutPage() {
  const { t } = useTranslation("checkout");
  const format = useFormat();
  const locale = useLocale();
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
  const [discountCode, setDiscountCode] = useState("");
  const [discountError, setDiscountError] = useState<string | null>(null);

  // Stores in the bag whose cash on delivery is paused (COD debt over the limit).
  const storeIds = [
    ...new Set(
      items.flatMap((i) => {
        const p = products.find((x) => x.id === i.productId);
        const s = p && stores.find((x) => x.slug === p.storeSlug);
        return s?.id ? [s.id] : [];
      }),
    ),
  ].sort();
  const cod = useQuery({
    queryKey: ["checkout", "cod", ...storeIds],
    queryFn: () => codPausedStores(storeIds),
    enabled: ready && storeIds.length > 0,
    staleTime: 30_000,
  });
  const paused = cod.data ?? [];
  const pausedNames = new Intl.ListFormat(locale, { type: "conjunction" }).format(
    paused.map((id) => stores.find((s) => s.id === id)?.name ?? id),
  );
  const rule = codRule(paused);

  const place = useMutation({
    mutationFn: () => checkoutService.placeOrder(items, values, provider, discountCode),
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
    onError: (e) => {
      // Nothing was ordered and the bag is untouched; let the shopper fix the code.
      if (isInvalidDiscountError(e)) {
        setDiscountError(t("checkout.discountNotValid", { ns: "errors" }));
        document.getElementById("checkout-discount")?.focus();
        return;
      }
      if (isCodPausedError(e)) {
        // The database refused: a store's COD was paused meanwhile. Re-check the bag.
        void cod.refetch();
        toast.error(t("checkout.codPaused", { ns: "errors" }));
        return;
      }
      toast.error(translateError(t, e, { "42501": "checkout.signInAgain" }));
    },
  });

  if (!ready) return <CatalogSkeleton />;
  if (!items.length)
    return (
      <main className="market-container">
        <EmptyState title={t("emptyTitle")} description={t("emptyText")} />
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
        <Link to="/cart">{t("yourBag")}</Link>
        <ChevronRight className="rtl:-scale-x-100" />
        <span>{t("title")}</span>
      </div>
      <h1 className="page-title">{t("title")}</h1>
      <p className="page-subtitle">{t("subtitle")}</p>
      <form
        className="cart-layout"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (place.isPending) return;
          const parsed = checkoutCustomerSchema.safeParse(values);
          if (!parsed.success) {
            // One translated message per field (word order may differ per language).
            const next: Partial<Record<Field, string>> = {};
            for (const issue of parsed.error.issues) {
              const field = issue.path[0] as Field;
              next[field] ??= validationMessage(t, field, issue, values[field]);
            }
            setErrors(next);
            document.getElementById(`checkout-${Object.keys(next)[0]}`)?.focus();
            return;
          }
          const code = discountCodeSchema.safeParse(discountCode);
          if (!code.success) {
            setDiscountError(t("checkout.discountFormat", { ns: "errors" }));
            document.getElementById("checkout-discount")?.focus();
            return;
          }
          setErrors({});
          setDiscountError(null);
          place.mutate();
        }}
      >
        <div className="seller-form">
          <fieldset className="seller-form-row" disabled={place.isPending}>
            <legend className="checkout-legend">{t("delivery")}</legend>
            {FIELDS.map((f) => (
              <div key={f.key} className={`seller-field ${f.wide ? "checkout-wide" : ""}`}>
                <Label htmlFor={`checkout-${f.key}`}>{t(`fields.${f.key}`)}</Label>
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
              <Label htmlFor="checkout-notes">{t("fields.notes")}</Label>
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
            <legend className="checkout-legend">{t("payment")}</legend>
            {PAYMENT_METHODS.map((m) => {
              const available = m.enabled && (m.id !== "cod" || rule.codAllowed);
              return (
                <label
                  key={m.id}
                  className={`checkout-payment ${provider === m.id && available ? "selected" : ""} ${available ? "" : "disabled"}`}
                >
                  <input
                    type="radio"
                    name="payment"
                    value={m.id}
                    disabled={!available}
                    checked={provider === m.id && available}
                    aria-describedby={
                      m.id === "cod" && !rule.codAllowed ? "checkout-cod-paused" : undefined
                    }
                    onChange={() => available && setProvider(m.id)}
                  />
                  <span>
                    <strong>{t(`methods.${m.id}`)}</strong>
                    <small>
                      {!m.enabled
                        ? t("methods.comingSoon")
                        : m.id === "cod" && !rule.codAllowed
                          ? t("methods.codPaused", { stores: pausedNames })
                          : t("methods.codDescription")}
                    </small>
                  </span>
                </label>
              );
            })}
            {!rule.codAllowed && (
              <p id="checkout-cod-paused" role="alert" className="seller-error">
                {rule.canPlace
                  ? t("methods.codPaused", { stores: pausedNames })
                  : t("cannotPlace", { stores: pausedNames })}
              </p>
            )}
          </fieldset>
        </div>

        <aside className="order-summary">
          <h2>{t("yourOrder")}</h2>
          <ul className="checkout-lines">
            {lines.map((l) => (
              <li key={l.productId}>
                <span className="min-w-0">
                  {t("line", { quantity: format.number(l.quantity), title: l.product.title })}
                  <small>{l.store?.name}</small>
                </span>
                <span>{format.price(l.product.price * l.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="summary-row summary-total">
            <span>{t("estimatedTotal")}</span>
            <span>{format.price(estimate)}</span>
          </div>
          <div className="seller-field mt-4">
            <Label htmlFor="checkout-discount">{t("discount")}</Label>
            <Input
              id="checkout-discount"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={t("discountPlaceholder")}
              value={discountCode}
              disabled={place.isPending}
              aria-invalid={!!discountError}
              aria-describedby="checkout-discount-help"
              onChange={(e) => {
                setDiscountCode(e.target.value.toUpperCase());
                setDiscountError(null);
              }}
            />
            <p
              id="checkout-discount-help"
              className={discountError ? "seller-error" : "seller-hint"}
              role={discountError ? "alert" : undefined}
            >
              {discountError ?? t("discountHelp")}
            </p>
          </div>
          <p className="checkout-note">{t("note")}</p>
          <Button
            type="submit"
            className="w-full h-11 mt-4"
            disabled={place.isPending || !rule.canPlace}
            aria-describedby={!rule.canPlace ? "checkout-cod-paused" : undefined}
          >
            <Lock />
            {place.isPending ? t("placing") : t("place")}
          </Button>
        </aside>
      </form>
    </main>
  );
}
