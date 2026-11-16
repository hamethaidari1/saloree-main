import { useTranslation } from "react-i18next";
import { headT } from "@/i18n/head";
import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banknote, ChevronDown, CreditCard, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCart } from "@/components/marketplace/cart-context";
import { LegalConsent, useLegalLinks } from "@/components/legal/legal-links";
import { CatalogSkeleton, EmptyState, useCatalog } from "@/components/marketplace/shared";
import { BrandLogo } from "@/components/marketplace/payment-methods";
import { CountryCombobox } from "@/components/checkout/country-combobox";
import { PaymentOverlay } from "@/components/checkout/payment-overlay";
import { usePaymentOverlay } from "@/components/checkout/use-payment-overlay";
import { requireAuth } from "@/lib/auth";
import { countryNameEn } from "@/lib/iso-countries";
import { PAYMENT_BRANDS } from "@/lib/payment-logos";
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
  paymentMethods,
  type CheckoutCustomerInput,
  type PaymentProvider,
} from "@/services/checkout";
import { CardPaymentError, cardPaymentService, groupPaymentState } from "@/services/card-payment";
import {
  clearPendingPayment,
  readPendingPayment,
  savePendingPayment,
  type PendingPayment,
} from "@/lib/pending-payment";

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
/** Labels come from checkout:fields.<key>. Country is the searchable ISO picker. */
const FIELDS: {
  key: Exclude<Field, "country" | "notes">;
  autoComplete: string;
  type?: string;
  inputMode?: "tel" | "email";
  wide?: boolean;
  hint?: string;
}[] = [
  { key: "full_name", autoComplete: "name" },
  { key: "phone", autoComplete: "tel", type: "tel", inputMode: "tel", hint: "phoneHint" },
  { key: "email", autoComplete: "email", type: "email", inputMode: "email", wide: true },
  { key: "city", autoComplete: "address-level2" },
  { key: "address", autoComplete: "street-address", wide: true },
];
const LEGAL_TRUST = ["returns", "shipping", "terms", "privacy"] as const;

function CheckoutPage() {
  const { t } = useTranslation("checkout");
  const format = useFormat();
  const locale = useLocale();
  const { user } = Route.useRouteContext();
  const { items, ready, clear } = useCart();
  const { products, stores } = useCatalog();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const legalLinks = useLegalLinks().filter((l) =>
    (LEGAL_TRUST as readonly string[]).includes(l.slug),
  );
  const [values, setValues] = useState<Record<Field, string>>({
    full_name: String(user.user_metadata?.["full_name"] ?? ""),
    phone: "",
    email: user.email ?? "",
    country: "",
    city: "",
    address: "",
    notes: "",
  });
  const [countryCode, setCountryCode] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string | undefined>>>({});
  const [provider, setProvider] = useState<PaymentProvider>("cod");
  const [discountCode, setDiscountCode] = useState("");
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [discountAdded, setDiscountAdded] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);

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
  const methods = paymentMethods();
  const cardOn = methods.some((m) => m.id === "stripe" && m.enabled);
  const rule = codRule(paused, cardOn);
  // With COD paused for a store in the bag, card is the way to pay.
  const method: PaymentProvider =
    provider === "cod" && !rule.codAllowed && cardOn ? "stripe" : provider;
  // Only what can really be chosen: card when Stripe is on, cash when every store accepts it.
  const offered = methods.filter(
    (m): m is Extract<(typeof methods)[number], { id: PaymentProvider }> =>
      m.enabled && (m.id === "stripe" || (m.id === "cod" && rule.codAllowed)),
  );

  // A card payment started from this tab and not finished (back from Stripe).
  const [pending, setPending] = useState<PendingPayment | null>(() => readPendingPayment());
  const [redirecting, setRedirecting] = useState(false);
  const overlay = usePaymentOverlay({
    // Back from Stripe via the browser's back button (page restored from cache).
    onPageRestore: () => {
      setRedirecting(false);
      setPending(readPendingPayment());
      void queryClient.invalidateQueries({ queryKey: ["checkout", "payment"] });
    },
  });
  const pendingCheck = useQuery({
    queryKey: ["checkout", "payment", pending?.groupId],
    queryFn: () => cardPaymentService.groupPayment(pending!.groupId),
    enabled: !!pending,
    retry: false,
  });
  const pendingState = pendingCheck.data ? groupPaymentState(pendingCheck.data) : null;
  const [ended, setEnded] = useState(false);
  if (
    pending &&
    (pendingState === "paid" || pendingState === "failed" || pendingState === "none")
  ) {
    // Paid meanwhile, or no longer payable: nothing to offer here any more.
    clearPendingPayment(pending.groupId);
    setPending(null);
    if (pendingState === "failed") setEnded(true);
  }
  const showRetry = !!pending && (pendingState === "pending" || pendingCheck.isError);

  /** The function's refusal, in plain words; an expired checkout goes back to the bag. */
  const onCardError = (e: unknown, groupId: string) => {
    if (e instanceof CardPaymentError && e.problem === "expired") {
      clearPendingPayment(groupId);
      setPending(null);
      toast.error(t("pending.expired"));
      void navigate({ to: "/cart" });
      return;
    }
    if (e instanceof CardPaymentError && e.problem === "paid") {
      clearPendingPayment(groupId);
      void navigate({ to: "/order-confirmation", search: { group: groupId } });
      return;
    }
    toast.error(translateError(t, e));
  };

  const retry = useMutation({
    mutationFn: (groupId: string) => cardPaymentService.startPayment(groupId),
    onSuccess: async (url) => {
      overlay.mark("connected");
      setRedirecting(true);
      await overlay.redirect(url);
    },
    onError: (e, groupId) => {
      overlay.close();
      onCardError(e, groupId);
    },
  });

  const place = useMutation({
    mutationFn: async () => {
      const result = await checkoutService.placeOrder(items, values, method, discountCode);
      queryClient.setQueryData(["checkout", result.checkout_group_id], result);
      if (method !== "stripe") return { result, url: null };
      // place_order returned: the order exists and its items are reserved.
      overlay.mark("placed");
      // Orders exist now (pending, stock reserved): remember them for "Try again".
      const groupId = result.checkout_group_id;
      savePendingPayment(groupId);
      setPending(readPendingPayment() ?? { groupId, at: Date.now() });
      try {
        const url = await cardPaymentService.startPayment(groupId);
        overlay.mark("connected");
        return { result, url };
      } catch (e) {
        throw new StartPaymentFailed(e, groupId);
      }
    },
    onSuccess: async ({ result, url }) => {
      if (url) {
        // The bag is emptied once the payment is confirmed, not before.
        setRedirecting(true);
        await overlay.redirect(url);
        return;
      }
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
      // Never wait on an error: back to the form at once.
      overlay.close();
      if (e instanceof StartPaymentFailed) {
        void queryClient.invalidateQueries({ queryKey: ["checkout", "payment"] });
        onCardError(e.cause, e.groupId);
        return;
      }
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

  // The pay button stays reachable on phones: room for the sticky bar.
  useEffect(() => {
    document.body.classList.add("has-checkout-bar");
    return () => document.body.classList.remove("has-checkout-bar");
  }, []);

  const retryNotice = showRetry && pending && (
    <div className="checkout-pending" role="alert" aria-live="polite">
      <p>{t("pending.notice")}</p>
      <div className="checkout-pending-actions">
        <Button
          type="button"
          disabled={retry.isPending || redirecting || overlay.state.open}
          onClick={() => {
            if (!overlay.start("retry")) return;
            retry.mutate(pending.groupId);
          }}
        >
          {retry.isPending || redirecting ? t("redirecting") : t("pending.retry")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={retry.isPending || redirecting}
          onClick={() => {
            clearPendingPayment(pending.groupId);
            setPending(null);
          }}
        >
          {t("pending.newOrder")}
        </Button>
      </div>
      <p className="seller-hint">{t("pending.newOrderHint")}</p>
    </div>
  );

  if (!ready) return <CatalogSkeleton />;
  if (!items.length)
    return (
      <main className="market-container checkout-page">
        {retryNotice}
        <EmptyState title={t("emptyTitle")} description={t("emptyText")} />
        <PaymentOverlay state={overlay.state} />
      </main>
    );

  const lines = items.flatMap((i) => {
    const p = products.find((x) => x.id === i.productId);
    return p ? [{ ...i, product: p, store: stores.find((s) => s.slug === p.storeSlug) }] : [];
  });
  const estimate = cartTotal(items, products);
  const total = format.price(estimate);
  const storeNames = [...new Set(lines.flatMap((l) => (l.store ? [l.store.name] : [])))];
  const formValid = checkoutCustomerSchema.safeParse(values).success && !!countryCode;
  const busy = place.isPending || redirecting || overlay.state.open;

  /** One field's message (on blur, and on submit). Never repeats what was typed. */
  const messageFor = (field: Field, next = values): string | undefined => {
    if (field === "country") return countryCode ? undefined : t("countryPick");
    const r = checkoutCustomerSchema.shape[field].safeParse(next[field]);
    return r.success ? undefined : validationMessage(t, field, r.error.issues[0]!, next[field]);
  };
  const checkField = (field: Field) => setErrors((e) => ({ ...e, [field]: messageFor(field) }));
  const setField = (field: Field, value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    // Once a message is shown, it updates as the shopper fixes the field.
    if (errors[field])
      setErrors((e) => ({ ...e, [field]: messageFor(field, { ...values, [field]: value }) }));
  };

  const submit = () => {
    if (busy || showRetry) return;
    const parsed = checkoutCustomerSchema.safeParse(values);
    const next: Partial<Record<Field, string | undefined>> = {};
    if (!parsed.success)
      // One translated message per field (word order may differ per language).
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as Field;
        next[field] ??= validationMessage(t, field, issue, values[field]);
      }
    if (!countryCode) next.country = t("countryPick");
    if (Object.keys(next).length) {
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
    // Card: the secure screen covers the page in this same click (and a second click is refused).
    if (method === "stripe" && !overlay.start("checkout")) return;
    place.mutate();
  };

  const payLabel = redirecting
    ? t("redirecting")
    : place.isPending
      ? t("placing")
      : method === "stripe"
        ? // A code changes the total, so the button doesn't promise the estimate then.
          discountCode.trim()
          ? t("toPayment")
          : t("payAmount", { amount: total })
        : t("place");

  return (
    <main className="market-container checkout-page">
      <nav className="checkout-steps" aria-label={t("steps.label")}>
        <ol>
          <li>
            <Link to="/cart">{t("steps.bag")}</Link>
          </li>
          <li aria-current={!formValid ? "step" : undefined}>{t("steps.delivery")}</li>
          <li aria-current={formValid ? "step" : undefined}>{t("steps.payment")}</li>
        </ol>
      </nav>
      <h1 className="page-title">{t("title")}</h1>
      <p className="page-subtitle">{t("subtitle")}</p>
      {retryNotice}
      {ended && !pending && (
        <p className="checkout-pending" role="status">
          {t("pending.expired")}
        </p>
      )}
      {lines.length < items.length && (
        <p className="checkout-notice" role="status">
          {t("unavailable")}
        </p>
      )}

      <form
        className="checkout-grid"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="checkout-main">
          <section className="checkout-card" aria-labelledby="checkout-delivery-title">
            <fieldset disabled={busy}>
              <legend id="checkout-delivery-title" className="checkout-legend">
                {t("delivery")}
              </legend>
              <div className="checkout-fields">
                {FIELDS.map((f) => (
                  <div key={f.key} className={`seller-field ${f.wide ? "checkout-wide" : ""}`}>
                    <Label htmlFor={`checkout-${f.key}`}>{t(`fields.${f.key}`)}</Label>
                    <Input
                      id={`checkout-${f.key}`}
                      name={f.key}
                      type={f.type ?? "text"}
                      inputMode={f.inputMode}
                      autoComplete={f.autoComplete}
                      value={values[f.key]}
                      aria-invalid={!!errors[f.key]}
                      aria-describedby={
                        [
                          f.hint ? `checkout-${f.key}-hint` : "",
                          errors[f.key] ? `checkout-${f.key}-error` : "",
                        ]
                          .filter(Boolean)
                          .join(" ") || undefined
                      }
                      onChange={(e) => setField(f.key, e.target.value)}
                      onBlur={() => values[f.key].trim() && checkField(f.key)}
                      required
                    />
                    {f.hint && (
                      <p id={`checkout-${f.key}-hint`} className="seller-hint">
                        {t(f.hint)}
                      </p>
                    )}
                    {errors[f.key] && (
                      <p id={`checkout-${f.key}-error`} className="seller-error">
                        {errors[f.key]}
                      </p>
                    )}
                  </div>
                ))}
                <div className="seller-field">
                  <Label htmlFor="checkout-country">{t("fields.country")}</Label>
                  <CountryCombobox
                    id="checkout-country"
                    value={countryCode}
                    disabled={busy}
                    invalid={!!errors.country}
                    describedBy={errors.country ? "checkout-country-error" : undefined}
                    placeholder={t("countryPlaceholder")}
                    noMatch={t("countryNone")}
                    listLabel={t("countryList")}
                    onChange={(code) => {
                      setCountryCode(code);
                      // The order keeps the country as before: its English name.
                      setValues((v) => ({ ...v, country: code ? countryNameEn(code) : "" }));
                      if (code) setErrors((e) => ({ ...e, country: undefined }));
                    }}
                    onBlur={() => values.country && !countryCode && checkField("country")}
                  />
                  {errors.country && (
                    <p id="checkout-country-error" className="seller-error">
                      {errors.country}
                    </p>
                  )}
                </div>
                <div className="seller-field checkout-wide">
                  <Label htmlFor="checkout-notes">{t("fields.notes")}</Label>
                  <Textarea
                    id="checkout-notes"
                    name="notes"
                    rows={3}
                    maxLength={500}
                    value={values.notes}
                    onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))}
                  />
                  {errors.notes && <p className="seller-error">{errors.notes}</p>}
                </div>
              </div>
            </fieldset>
          </section>

          <section className="checkout-card" aria-labelledby="checkout-payment-title">
            <fieldset disabled={busy} className="checkout-payments">
              <legend id="checkout-payment-title" className="checkout-legend">
                {t("payment")}
              </legend>
              {offered.map((m) => {
                const selected = method === m.id;
                return (
                  <label
                    key={m.id}
                    className={`checkout-method ${selected ? "selected" : ""}`}
                    data-testid={`method-${m.id}`}
                  >
                    <input
                      type="radio"
                      name="payment"
                      value={m.id}
                      checked={selected}
                      onChange={() => setProvider(m.id)}
                    />
                    <span className="checkout-method-icon" aria-hidden>
                      {m.id === "stripe" ? <CreditCard /> : <Banknote />}
                    </span>
                    <span className="checkout-method-text">
                      <strong>{t(`methods.${m.id}`)}</strong>
                      <small>
                        {m.id === "stripe" ? t("cardHelp") : t("methods.codDescription")}
                      </small>
                      {m.id === "stripe" && (
                        <ul className="pay-list checkout-brands" aria-label={t("cardBrands")}>
                          {PAYMENT_BRANDS.map((b) => (
                            <BrandLogo key={b.id} brand={b} />
                          ))}
                        </ul>
                      )}
                    </span>
                  </label>
                );
              })}
              {/* Why cash isn't offered (the option is hidden while a store has it paused). */}
              {!rule.codAllowed && !rule.canPlace && (
                <p className="seller-hint">{t("methods.codPaused", { stores: pausedNames })}</p>
              )}
              {!rule.codAllowed && (
                <p id="checkout-cod-paused" role="alert" className="seller-error">
                  {rule.canPlace
                    ? t("methods.codPaused", { stores: pausedNames })
                    : t("cannotPlace", { stores: pausedNames })}
                </p>
              )}
            </fieldset>
          </section>
        </div>

        <div className="checkout-side">
          <aside className="checkout-card order-summary" aria-labelledby="checkout-summary-title">
            <button
              type="button"
              className="checkout-summary-toggle"
              aria-expanded={summaryOpen}
              aria-controls="checkout-summary-body"
              onClick={() => setSummaryOpen((o) => !o)}
            >
              <span>{summaryOpen ? t("hideSummary") : t("showSummary")}</span>
              <strong>{total}</strong>
              <ChevronDown aria-hidden className={summaryOpen ? "rotate-180" : undefined} />
            </button>
            <div
              id="checkout-summary-body"
              className="checkout-summary-body"
              data-collapsed={!summaryOpen || undefined}
            >
              <h2 id="checkout-summary-title">{t("yourOrder")}</h2>
              <ul className="checkout-items">
                {lines.map((l) => (
                  <li key={l.productId}>
                    <img src={l.product.image} alt="" loading="lazy" width={56} height={56} />
                    <span className="min-w-0 flex-1">
                      <span className="checkout-item-title" dir="auto" title={l.product.title}>
                        {t("line", { quantity: format.number(l.quantity), title: l.product.title })}
                      </span>
                      {l.store && <small>{l.store.name}</small>}
                    </span>
                    <span className="checkout-item-price">
                      {format.price(l.product.price * l.quantity)}
                    </span>
                  </li>
                ))}
              </ul>
              {storeNames.length > 1 && (
                <p className="checkout-note">
                  {t("separateOrders", {
                    stores: new Intl.ListFormat(locale, { type: "conjunction" }).format(storeNames),
                  })}
                </p>
              )}
              <div className="seller-field checkout-discount">
                <Label htmlFor="checkout-discount">{t("discount")}</Label>
                <div className="checkout-discount-row">
                  <Input
                    id="checkout-discount"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    placeholder={t("discountPlaceholder")}
                    value={discountCode}
                    disabled={busy}
                    aria-invalid={!!discountError}
                    aria-describedby="checkout-discount-help"
                    onChange={(e) => {
                      setDiscountCode(e.target.value.toUpperCase());
                      setDiscountError(null);
                      setDiscountAdded(false);
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || !discountCode.trim()}
                    onClick={() => {
                      // Only the format is checked here; the store checks the code when you order.
                      const code = discountCodeSchema.safeParse(discountCode);
                      if (!code.success) {
                        setDiscountError(t("checkout.discountFormat", { ns: "errors" }));
                        return;
                      }
                      setDiscountError(null);
                      setDiscountAdded(true);
                    }}
                  >
                    {t("apply")}
                  </Button>
                </div>
                <p
                  id="checkout-discount-help"
                  className={discountError ? "seller-error" : "seller-hint"}
                  role={discountError ? "alert" : discountAdded ? "status" : undefined}
                >
                  {discountError ??
                    (discountAdded
                      ? t("discountAdded", { code: discountCode.trim() })
                      : t("discountHelp"))}
                </p>
              </div>
              <div className="summary-row summary-total">
                <span>{t("estimatedTotal")}</span>
                <span data-testid="checkout-total">{total}</span>
              </div>
              <p className="checkout-note">{t("note")}</p>
              {method === "stripe" && <p className="checkout-note">{t("cardNote")}</p>}
            </div>
          </aside>

          <div className="checkout-pay">
            <ul className="checkout-trust" aria-label={t("trust.label")}>
              {cardOn && (
                <li>
                  <Lock aria-hidden />
                  {t("trust.secure")}
                </li>
              )}
              {rule.codAllowed && (
                <li>
                  <ShieldCheck aria-hidden />
                  {t("trust.cod")}
                </li>
              )}
              {legalLinks.length > 0 && (
                <li className="checkout-trust-links">
                  {legalLinks.map((l) => (
                    <Link
                      key={l.slug}
                      to="/legal/$slug"
                      params={{ slug: l.slug }}
                      target="_blank"
                      rel="noopener"
                    >
                      {l.label}
                    </Link>
                  ))}
                </li>
              )}
            </ul>
            <LegalConsent className="checkout-note legal-consent" />
            <Button
              type="submit"
              className="checkout-submit"
              disabled={busy || showRetry || !rule.canPlace}
              // Looks unavailable until the details are complete, but still explains why when pressed.
              aria-disabled={!formValid || undefined}
              data-incomplete={!formValid || undefined}
              aria-describedby={
                !rule.canPlace
                  ? "checkout-cod-paused"
                  : !formValid
                    ? "checkout-incomplete"
                    : undefined
              }
            >
              <Lock />
              {payLabel}
            </Button>
            {!formValid && rule.canPlace && (
              <p id="checkout-incomplete" className="seller-hint checkout-incomplete">
                {t("fillToContinue")}
              </p>
            )}
          </div>
        </div>
      </form>
      <PaymentOverlay state={overlay.state} />
    </main>
  );
}

/** place_order succeeded but Stripe's page could not be opened (orders stay pending). */
class StartPaymentFailed extends Error {
  constructor(
    override readonly cause: unknown,
    readonly groupId: string,
  ) {
    super("The payment page could not be opened.");
  }
}
