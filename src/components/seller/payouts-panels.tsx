import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, Copy, Eye, EyeOff, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog, type ConfirmRequest } from "@/components/marketplace/confirm-dialog";
import { StatTile } from "./stats";
import { money } from "@/services/catalog";
import {
  entryKindLabel,
  filterOrders,
  isCod,
  maskAccount,
  methodLabel,
  nextRelease,
  ORDER_STATES,
  pageOf,
  PAYOUT_METHODS,
  payoutAccountSchema,
  payoutError,
  payoutsService,
  stateLabel,
  stateTone,
  type Earnings,
  type EarningsOrder,
  type PayoutAccount,
  type PayoutAccountInput,
  type PayoutEntry,
} from "@/services/payouts";

export const payoutKeys = {
  all: ["payouts"] as const,
  earnings: (storeId: string) => ["payouts", storeId, "earnings"] as const,
  orders: (storeId: string) => ["payouts", storeId, "orders"] as const,
  entries: (storeId: string) => ["payouts", storeId, "entries"] as const,
  account: (storeId: string) => ["payouts", storeId, "account"] as const,
  overview: ["payouts", "overview"] as const,
  settings: ["payouts", "settings"] as const,
};

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

/** A load error with the real message and a retry. */
export function PayoutLoadError({
  what,
  error,
  retry,
}: {
  what: string;
  error: unknown;
  retry: () => void;
}) {
  return (
    <div role="alert" className="seller-empty">
      <h3>{what} could not be loaded.</h3>
      <p>{payoutError(error)}</p>
      <Button variant="outline" size="sm" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}

export function StateBadge({ state }: { state: string }) {
  return (
    <span className="payout-badge" data-tone={stateTone(state)}>
      {stateLabel(state)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Cards + rules
// ---------------------------------------------------------------------------
export function EarningsCards({ e, orders }: { e: Earnings; orders: EarningsOrder[] | undefined }) {
  const next = orders ? nextRelease(orders) : null;
  const c = e.currency;
  return (
    <div className="grid gap-4">
      <div className="admin-tiles">
        <StatTile
          label="Awaiting delivery"
          value={money(e.awaiting_delivery, c)}
          detail="Paid online, not delivered yet"
        />
        <StatTile
          label="In hold"
          value={money(e.in_hold, c)}
          detail={
            next ? `Next release ${day(next)}` : `Released ${e.hold_days} days after delivery`
          }
        />
        <StatTile
          label="Ready to pay out"
          value={money(e.payable, c)}
          detail={`Minimum payout ${money(e.min_payout, c)}`}
        />
        <StatTile label="Paid out" value={money(e.paid_out, c)} />
      </div>
      <section
        className="payout-cod"
        aria-labelledby="cod-heading"
        data-blocked={!e.accepting_cod || undefined}
      >
        <div>
          <h2 id="cod-heading" className="text-base font-semibold">
            Cash on delivery commission due
          </h2>
          <p className="seller-hint">
            Commission on delivered cash orders you collected yourself. Limit{" "}
            {money(e.cod_debt_limit, c)}.
          </p>
        </div>
        <strong className="payout-cod-amount">{money(e.cod_debt, c)}</strong>
      </section>
      {!e.accepting_cod && (
        <p role="alert" className="payout-alert">
          <AlertTriangle aria-hidden size={18} />
          New cash-on-delivery orders are paused until you settle {money(e.cod_debt, c)}. Online
          orders still work.
        </p>
      )}
    </div>
  );
}

export function PayoutRules({ e }: { e: Earnings }) {
  const c = e.currency;
  return (
    <section className="seller-card payout-rules" aria-labelledby="payout-rules-heading">
      <h2 id="payout-rules-heading" className="mb-2 text-base font-semibold">
        How you get paid
      </h2>
      <ul>
        <li>
          <strong>Online orders:</strong> your share is released {e.hold_days} day
          {e.hold_days === 1 ? "" : "s"} after the order is delivered. Saloree pays out released
          money every week, once it reaches {money(e.min_payout, c)}.
        </li>
        <li>
          <strong>Cash on delivery:</strong> you keep the cash and owe Saloree the commission of
          delivered cash orders. You can pay it by bank transfer, or we deduct it from your online
          earnings.
        </li>
        <li>
          If the commission you owe goes above {money(e.cod_debt_limit, c)}, your store can't take
          new cash-on-delivery orders until it is settled.
        </li>
        <li>All amounts are in {c}.</li>
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Orders table
// ---------------------------------------------------------------------------
export function EarningsOrdersTable({
  orders,
  currency = "USD",
}: {
  orders: EarningsOrder[];
  currency?: string;
}) {
  const [state, setState] = useState("");
  const [page, setPage] = useState(0);
  const list = filterOrders(orders, state);
  const p = pageOf(list, page);
  if (!orders.length)
    return <p className="seller-hint">No orders yet. Earnings appear here once customers order.</p>;
  return (
    <div className="grid gap-3">
      <label className="seller-field payout-filter">
        <span className="seller-label">State</span>
        <select
          className="seller-select"
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All states</option>
          {Object.entries(ORDER_STATES).map(([value, s]) => (
            <option key={value} value={value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {!list.length ? (
        <p className="seller-hint">No orders in this state.</p>
      ) : (
        <div className="staff-table-wrap">
          <table className="seller-order-table payout-orders">
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Order</th>
                <th scope="col">Payment</th>
                <th scope="col" className="text-end">
                  Total
                </th>
                <th scope="col" className="text-end">
                  Commission
                </th>
                <th scope="col" className="text-end">
                  Your share
                </th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {p.rows.map((o) => (
                <tr key={o.order_id}>
                  <td>{day(o.created_at)}</td>
                  <td className="font-mono">#{o.order_id.slice(0, 8)}</td>
                  <td>{isCod(o.payment_provider) ? "COD" : "Online"}</td>
                  <td className="text-end">{money(o.total, currency)}</td>
                  <td className="text-end">{money(o.commission_amount, currency)}</td>
                  <td className="text-end">{money(o.seller_amount, currency)}</td>
                  <td>
                    <StateBadge state={o.state} />
                    {o.release_at && o.state === "in_hold" && (
                      <span className="seller-hint block">Released {day(o.release_at)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {p.pages > 1 && (
        <nav className="staff-pager" aria-label="Order pages">
          <Button
            variant="outline"
            size="sm"
            disabled={p.page === 0}
            onClick={() => setPage(p.page - 1)}
          >
            Previous
          </Button>
          <span className="seller-hint">
            Page {p.page + 1} of {p.pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={p.page >= p.pages - 1}
            onClick={() => setPage(p.page + 1)}
          >
            Next
          </Button>
        </nav>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payout history
// ---------------------------------------------------------------------------
export function PayoutHistory({ entries }: { entries: PayoutEntry[] }) {
  if (!entries.length) return <p className="seller-hint">No payouts yet.</p>;
  return (
    <div className="staff-table-wrap">
      <table className="seller-order-table">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Type</th>
            <th scope="col" className="text-end">
              Amount
            </th>
            <th scope="col">Reference</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{day(e.created_at)}</td>
              <td>{entryKindLabel(e.kind)}</td>
              <td className="text-end">{money(e.amount, e.currency)}</td>
              <td dir="auto">{e.reference ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payout details
// ---------------------------------------------------------------------------
export function VerifiedBadge({ account }: { account: Pick<PayoutAccount, "verified_at"> }) {
  return account.verified_at ? (
    <span className="payout-badge" data-tone="good">
      <BadgeCheck aria-hidden size={14} /> Verified
    </span>
  ) : (
    <span className="payout-badge" data-tone="warn">
      Not verified yet
    </span>
  );
}

/**
 * Details as facts. The account number is masked unless `reveal` is on
 * (finance's "Show" toggle); copy buttons copy the real values.
 */
export function AccountFacts({
  account,
  reveal = false,
  copyable = false,
}: {
  account: PayoutAccount;
  reveal?: boolean;
  copyable?: boolean;
}) {
  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error(`Could not copy the ${label.toLowerCase()}.`);
    }
  };
  const row = (label: string, value: ReactNode, raw?: string | null) => (
    <>
      <dt>{label}</dt>
      <dd>
        {value}
        {copyable && raw && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Copy ${label.toLowerCase()}`}
            onClick={() => void copy(label, raw)}
          >
            <Copy aria-hidden size={14} />
          </Button>
        )}
      </dd>
    </>
  );
  return (
    <dl className="staff-facts payout-facts">
      {row("Method", methodLabel(account.method))}
      {row(
        "Account holder",
        <span dir="auto">{account.account_holder}</span>,
        account.account_holder,
      )}
      {row("Country", account.country)}
      {account.bank_name && row("Bank", account.bank_name)}
      {row(
        account.method === "hesabpay" ? "Wallet number" : "Account number / IBAN",
        <span className="font-mono" dir="ltr">
          {reveal ? account.account_number : maskAccount(account.account_number)}
        </span>,
        account.account_number,
      )}
      {account.swift_bic &&
        row("SWIFT/BIC", <span className="font-mono">{account.swift_bic}</span>)}
      {account.note && row("Note", <span dir="auto">{account.note}</span>)}
    </dl>
  );
}

type FormValues = Record<keyof PayoutAccountInput, string>;
const EMPTY: FormValues = {
  method: "bank_transfer",
  account_holder: "",
  country: "",
  bank_name: "",
  account_number: "",
  swift_bic: "",
  note: "",
};
const fromAccount = (a: PayoutAccount | null): FormValues =>
  a
    ? {
        method: a.method,
        account_holder: a.account_holder,
        country: a.country,
        bank_name: a.bank_name ?? "",
        account_number: a.account_number,
        swift_bic: a.swift_bic ?? "",
        note: a.note ?? "",
      }
    : EMPTY;

/** The owner's payout details: masked view, edit form, remove. */
export function PayoutDetails({
  storeId,
  payable,
  currency,
}: {
  storeId: string;
  payable: number;
  currency: string;
}) {
  const queryClient = useQueryClient();
  const account = useQuery({
    queryKey: payoutKeys.account(storeId),
    queryFn: () => payoutsService.getAccount(storeId),
  });
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: payoutKeys.all });
  const remove = useMutation({
    mutationFn: () => payoutsService.removeAccount(storeId),
    onSuccess: () => toast.success("Payout details removed"),
    onError: (e) => toast.error(payoutError(e)),
    onSettled: refresh,
  });

  return (
    <section className="seller-card" aria-labelledby="payout-details-heading">
      <div className="payout-section-head">
        <h2 id="payout-details-heading" className="text-base font-semibold">
          Payout details
        </h2>
        {account.data && <VerifiedBadge account={account.data} />}
      </div>
      <p className="seller-hint mb-3">
        Saloree pays you here. Make sure the account holder name matches your registration.
      </p>
      {account.isPending ? (
        <div className="nav-skeleton" aria-busy="true" aria-label="Loading payout details" />
      ) : account.isError ? (
        <PayoutLoadError
          what="Your payout details"
          error={account.error}
          retry={() => void account.refetch()}
        />
      ) : editing || !account.data ? (
        <>
          {!account.data && payable > 0 && (
            <p role="alert" className="payout-alert">
              <AlertTriangle aria-hidden size={18} />
              You have {money(payable, currency)} ready to pay out. Add your payout details so
              Saloree can pay you.
            </p>
          )}
          {account.data || editing ? (
            <PayoutDetailsForm
              storeId={storeId}
              initial={fromAccount(account.data)}
              verified={!!account.data?.verified_at}
              onDone={() => setEditing(false)}
              onCancel={account.data ? () => setEditing(false) : undefined}
            />
          ) : (
            <Button onClick={() => setEditing(true)}>Add payout details</Button>
          )}
        </>
      ) : (
        <div className="grid gap-3">
          <AccountFacts account={account.data} />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEditing(true)}>
              Edit details
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                setConfirm({
                  title: "Remove your payout details?",
                  description: "Saloree can't pay you until you add details again.",
                  confirmLabel: "Remove details",
                  destructive: true,
                  run: () => remove.mutateAsync(),
                })
              }
            >
              Remove details
            </Button>
          </div>
        </div>
      )}
      <ConfirmDialog request={confirm} busy={remove.isPending} onClose={() => setConfirm(null)} />
    </section>
  );
}

const FIELDS: { key: keyof FormValues; label: string; help?: string; mono?: boolean }[] = [
  { key: "account_holder", label: "Account holder" },
  { key: "country", label: "Country" },
  { key: "bank_name", label: "Bank name" },
  { key: "account_number", label: "IBAN / account number", mono: true },
  {
    key: "swift_bic",
    label: "SWIFT/BIC (optional)",
    help: "8 or 11 letters and numbers.",
    mono: true,
  },
];

function PayoutDetailsForm({
  storeId,
  initial,
  verified,
  onDone,
  onCancel,
}: {
  storeId: string;
  initial: FormValues;
  verified: boolean;
  onDone: () => void;
  onCancel?: (() => void) | undefined;
}) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const save = useMutation({
    mutationFn: () => payoutsService.saveAccount(storeId, values),
    onSuccess: () => {
      toast.success("Payout details saved");
      onDone();
    },
    onError: (e) => toast.error(payoutError(e)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: payoutKeys.all }),
  });
  const set = (k: keyof FormValues, v: string) => setValues((s) => ({ ...s, [k]: v }));
  const hesab = values.method === "hesabpay";

  return (
    <form
      className="seller-form"
      noValidate
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = payoutAccountSchema.safeParse(values);
        if (!parsed.success) {
          const next: Partial<Record<keyof FormValues, string>> = {};
          for (const i of parsed.error.issues) next[i.path[0] as keyof FormValues] ??= i.message;
          setErrors(next);
          document.getElementById(`payout-${Object.keys(next)[0]}`)?.focus();
          return;
        }
        setErrors({});
        save.mutate();
      }}
    >
      {verified && (
        <p className="staff-note" role="note">
          <Info aria-hidden size={16} /> Your details are verified. Saving changes removes the
          verification until Saloree checks them again.
        </p>
      )}
      {!verified && <p className="seller-hint">Not verified yet — changes remove verification.</p>}
      <div className="seller-field">
        <Label htmlFor="payout-method">Payout method</Label>
        <select
          id="payout-method"
          className="seller-select"
          value={values.method}
          onChange={(e) => set("method", e.target.value)}
        >
          {PAYOUT_METHODS.map((m) => (
            <option key={m} value={m}>
              {methodLabel(m)}
            </option>
          ))}
        </select>
      </div>
      {FIELDS.filter(
        (f) => !(f.key === "bank_name" && hesab) && !(f.key === "swift_bic" && hesab),
      ).map((f) => (
        <div key={f.key} className="seller-field">
          <Label htmlFor={`payout-${f.key}`}>
            {f.key === "account_number" && hesab ? "HesabPay wallet number" : f.label}
          </Label>
          <Input
            id={`payout-${f.key}`}
            className={f.mono ? "font-mono" : undefined}
            dir={f.mono ? "ltr" : "auto"}
            autoComplete="off"
            spellCheck={false}
            value={values[f.key]}
            aria-invalid={!!errors[f.key]}
            aria-describedby={errors[f.key] || f.help ? `payout-${f.key}-help` : undefined}
            onChange={(e) => set(f.key, e.target.value)}
          />
          {(errors[f.key] || f.help) && (
            <p
              id={`payout-${f.key}-help`}
              className={errors[f.key] ? "seller-error" : "seller-hint"}
            >
              {errors[f.key] ?? f.help}
            </p>
          )}
        </div>
      ))}
      <div className="seller-field">
        <Label htmlFor="payout-note">Note (optional)</Label>
        <Textarea
          id="payout-note"
          rows={2}
          maxLength={500}
          value={values.note}
          onChange={(e) => set("note", e.target.value)}
        />
        {errors.note && <p className="seller-error">{errors.note}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save payout details"}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" disabled={save.isPending} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/** The two show/hide buttons finance uses (kept here so the label logic is shared). */
export function RevealToggle({
  reveal,
  onChange,
}: {
  reveal: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-pressed={reveal}
      onClick={() => onChange(!reveal)}
    >
      {reveal ? <EyeOff aria-hidden size={14} /> : <Eye aria-hidden size={14} />}
      {reveal ? "Hide" : "Show"} account number
    </Button>
  );
}
