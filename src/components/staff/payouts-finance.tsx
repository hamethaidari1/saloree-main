import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ConfirmDialog, type ConfirmRequest } from "@/components/marketplace/confirm-dialog";
import { StatTile, TilesSkeleton } from "@/components/seller/stats";
import {
  AccountFacts,
  EarningsOrdersTable,
  PayoutHistory,
  PayoutLoadError,
  RevealToggle,
  VerifiedBadge,
  payoutKeys,
} from "@/components/seller/payouts-panels";
import { adminKeys } from "@/components/admin/keys";
import { downloadText } from "@/lib/download";
import { money } from "@/services/catalog";
import { currentUserId } from "@/services/admin";
import { financeService } from "@/services/finance";
import {
  accountStatus,
  buildPayoutCsv,
  defaultAmount,
  ENTRY_KIND_LABEL,
  filterPayables,
  maskAccount,
  methodLabel,
  payoutEntryInputSchema,
  payoutError,
  payoutSettingsSchema,
  payoutsService,
  type EntryKind,
  type PayablesFilter,
  type PayoutAccount,
  type StorePayables,
} from "@/services/payouts";

const FILTERS: [PayablesFilter, string][] = [
  ["", "All stores"],
  ["ready", "Ready to pay"],
  ["cod_debt", "COD debt > 0"],
  ["no_account", "No payout details"],
];

function useRefreshPayouts() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: payoutKeys.all });
}

export function AccountStatusBadge({ s }: { s: StorePayables }) {
  const status = accountStatus(s);
  if (status === "none")
    return (
      <span className="payout-badge" data-tone="warn">
        No details
      </span>
    );
  return (
    <span className="payout-badge" data-tone={status === "verified" ? "good" : "neutral"}>
      {status === "verified" ? "Verified" : "Unverified"} · {methodLabel(s.account_method)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Payouts tab
// ---------------------------------------------------------------------------
export function PayoutsFinancePanel() {
  const overview = useQuery({
    queryKey: payoutKeys.overview,
    queryFn: payoutsService.overview,
    retry: false,
  });
  const [filter, setFilter] = useState<PayablesFilter>("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [exporting, setExporting] = useState(false);

  if (overview.isPending) return <TilesSkeleton count={3} />;
  if (overview.isError)
    return (
      <PayoutLoadError
        what="Payables"
        error={overview.error}
        retry={() => void overview.refetch()}
      />
    );

  const o = overview.data;
  const list = filterPayables(o.stores, filter, query);
  const ready = o.stores.filter((s) => s.ready_to_pay);
  const selected = o.stores.find((s) => s.store_id === open) ?? null;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const accounts = await payoutsService.accountsFor(ready.map((s) => s.store_id));
      const csv = buildPayoutCsv(ready, accounts);
      downloadText(
        `saloree-payouts-${new Date().toISOString().slice(0, 10)}.csv`,
        csv,
        "text/csv;charset=utf-8",
      );
      toast.success(
        `Payment file for ${ready.length} store${ready.length === 1 ? "" : "s"} downloaded`,
      );
    } catch (e) {
      toast.error(payoutError(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <section aria-labelledby="payouts-heading" className="grid gap-4">
      <div className="seller-panel-head">
        <div>
          <h2 id="payouts-heading">Payouts</h2>
          <p>
            Sellers' balances. Online earnings are released {o.hold_days} days after delivery;
            minimum payout {money(o.min_payout)}; COD debt limit {money(o.cod_debt_limit)}.
          </p>
        </div>
        <Button
          variant="outline"
          disabled={!ready.length || exporting}
          onClick={() =>
            setConfirm({
              title: "Download the payment file?",
              description: `A CSV of the ${ready.length} store${ready.length === 1 ? "" : "s"} ready to pay, with their FULL account numbers (you need them to pay). Only finance and admins can download it. Keep the file private and delete it after paying.`,
              confirmLabel: "Download CSV",
              run: exportCsv,
            })
          }
        >
          <Download aria-hidden /> Download CSV of ready-to-pay stores
        </Button>
      </div>
      <p className="staff-note" role="note">
        <Info aria-hidden size={16} />
        Recording a payout does NOT send money. Send the transfer from the bank first, then record
        it here.
      </p>
      <div className="staff-filters staff-filters-wrap" role="group" aria-label="Filter stores">
        <Input
          type="search"
          className="admin-search"
          placeholder="Store name"
          aria-label="Search stores"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label="Show"
          className="staff-select"
          value={filter}
          onChange={(e) => setFilter(e.target.value as PayablesFilter)}
        >
          {FILTERS.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {!o.stores.length ? (
        <p className="seller-hint">No stores have earnings yet.</p>
      ) : !list.length ? (
        <p className="seller-hint">No stores match these filters.</p>
      ) : (
        <div className="staff-table-wrap">
          <table className="seller-order-table">
            <thead>
              <tr>
                <th scope="col">Store</th>
                <th scope="col" className="text-end">
                  Awaiting
                </th>
                <th scope="col" className="text-end">
                  In hold
                </th>
                <th scope="col" className="text-end" aria-sort="descending">
                  Payable
                </th>
                <th scope="col" className="text-end">
                  COD debt
                </th>
                <th scope="col">Payout details</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.store_id}>
                  <td dir="auto">
                    <button
                      type="button"
                      className="staff-link"
                      onClick={() => setOpen(s.store_id)}
                    >
                      {s.name}
                    </button>
                  </td>
                  <td className="text-end">{money(s.awaiting_delivery)}</td>
                  <td className="text-end">{money(s.in_hold)}</td>
                  <td className="text-end">
                    <strong>{money(s.payable)}</strong>
                  </td>
                  <td className="text-end">{money(s.cod_debt)}</td>
                  <td>
                    <AccountStatusBadge s={s} />
                  </td>
                  <td>
                    <span className="payout-badges">
                      {s.ready_to_pay && (
                        <span className="payout-badge" data-tone="good">
                          Ready to pay
                        </span>
                      )}
                      {!s.accepting_cod && (
                        <span className="payout-badge" data-tone="warn">
                          COD blocked
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <StoreDrawer store={selected} minPayout={o.min_payout} onClose={() => setOpen(null)} />
      <ConfirmDialog request={confirm} busy={exporting} onClose={() => setConfirm(null)} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Store drawer
// ---------------------------------------------------------------------------
function StoreDrawer({
  store,
  minPayout,
  onClose,
}: {
  store: StorePayables | null;
  minPayout: number;
  onClose: () => void;
}) {
  return (
    <Sheet open={!!store} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="staff-drawer overflow-y-auto">
        {store && <StoreDrawerBody key={store.store_id} s={store} minPayout={minPayout} />}
      </SheetContent>
    </Sheet>
  );
}

function StoreDrawerBody({ s, minPayout }: { s: StorePayables; minPayout: number }) {
  const id = s.store_id;
  const orders = useQuery({
    queryKey: payoutKeys.orders(id),
    queryFn: () => payoutsService.earningsOrders(id),
  });
  const entries = useQuery({
    queryKey: payoutKeys.entries(id),
    queryFn: () => payoutsService.entries(id),
  });
  const account = useQuery({
    queryKey: payoutKeys.account(id),
    queryFn: () => payoutsService.getAccount(id),
  });
  const [reveal, setReveal] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const refresh = useRefreshPayouts();
  const verify = useMutation({
    mutationFn: (v: boolean) => payoutsService.verifyAccount(id, v),
    onSuccess: (_d, v) => toast.success(v ? "Payout details verified" : "Verification removed"),
    onError: (e) => toast.error(payoutError(e)),
    onSettled: refresh,
  });

  return (
    <>
      <SheetHeader>
        <SheetTitle dir="auto">{s.name}</SheetTitle>
        <SheetDescription>Balances, orders, payouts and payout details.</SheetDescription>
      </SheetHeader>
      <div className="grid gap-5 py-4">
        <div className="admin-tiles">
          <StatTile label="Awaiting delivery" value={money(s.awaiting_delivery)} />
          <StatTile label="In hold" value={money(s.in_hold)} />
          <StatTile
            label="Payable"
            value={money(s.payable)}
            detail={s.ready_to_pay ? "Ready to pay" : `Minimum ${money(minPayout)}`}
          />
          <StatTile label="Paid out" value={money(s.paid_out)} />
          <StatTile
            label="COD debt"
            value={money(s.cod_debt)}
            detail={s.accepting_cod ? undefined : "COD blocked"}
          />
        </div>

        <section aria-labelledby="drawer-account">
          <div className="payout-section-head">
            <h3 id="drawer-account" className="font-semibold">
              Payout details
            </h3>
            {account.data && <VerifiedBadge account={account.data} />}
          </div>
          {account.isPending ? (
            <div className="nav-skeleton" aria-busy="true" aria-label="Loading payout details" />
          ) : account.isError ? (
            <PayoutLoadError
              what="Payout details"
              error={account.error}
              retry={() => void account.refetch()}
            />
          ) : !account.data ? (
            <p className="seller-hint">The seller hasn't added payout details yet.</p>
          ) : (
            <div className="grid gap-2">
              <AccountFacts account={account.data} reveal={reveal} copyable />
              <div className="payout-actions">
                <RevealToggle reveal={reveal} onChange={setReveal} />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={verify.isPending}
                  onClick={() => {
                    const on = !account.data!.verified_at;
                    setConfirm({
                      title: on ? "Verify these payout details?" : "Remove the verification?",
                      description: on
                        ? `You checked that ${account.data!.account_holder} (${maskAccount(account.data!.account_number)}) belongs to ${s.name}.`
                        : "The seller will see the details as not verified.",
                      confirmLabel: on ? "Verify details" : "Remove verification",
                      run: () => verify.mutateAsync(on),
                    });
                  }}
                >
                  {account.data.verified_at ? "Remove verification" : "Verify details"}
                </Button>
              </div>
            </div>
          )}
        </section>

        <EntryActions s={s} account={account.data ?? null} />

        <section aria-labelledby="drawer-entries">
          <h3 id="drawer-entries" className="mb-2 font-semibold">
            Payout history
          </h3>
          {entries.isPending ? (
            <div className="nav-skeleton" aria-busy="true" aria-label="Loading history" />
          ) : entries.isError ? (
            <PayoutLoadError
              what="Payout history"
              error={entries.error}
              retry={() => void entries.refetch()}
            />
          ) : (
            <PayoutHistory entries={entries.data} />
          )}
        </section>

        <section aria-labelledby="drawer-orders">
          <h3 id="drawer-orders" className="mb-2 font-semibold">
            Orders
          </h3>
          {orders.isPending ? (
            <div className="nav-skeleton" aria-busy="true" aria-label="Loading orders" />
          ) : orders.isError ? (
            <PayoutLoadError
              what="Orders"
              error={orders.error}
              retry={() => void orders.refetch()}
            />
          ) : (
            <EarningsOrdersTable orders={orders.data} />
          )}
        </section>
      </div>
      <ConfirmDialog request={confirm} busy={verify.isPending} onClose={() => setConfirm(null)} />
    </>
  );
}

const ACTIONS: { kind: EntryKind; label: string; help: string }[] = [
  {
    kind: "payout",
    label: "Record payout",
    help: "You already sent this money to the seller's account.",
  },
  {
    kind: "cod_offset",
    label: "Offset COD debt from earnings",
    help: "Takes the COD commission the seller owes out of their online earnings.",
  },
  {
    kind: "cod_settlement",
    label: "Record COD settlement",
    help: "The seller paid the COD commission to Saloree by transfer.",
  },
];

/** Record payout / offset / settlement, each confirmed with store, amount (and account). */
export function EntryActions({ s, account }: { s: StorePayables; account: PayoutAccount | null }) {
  const [kind, setKind] = useState<EntryKind | null>(null);
  const [values, setValues] = useState({ amount: "", reference: "", note: "" });
  const [errors, setErrors] = useState<Partial<Record<"amount" | "reference" | "note", string>>>(
    {},
  );
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const refresh = useRefreshPayouts();
  const record = useMutation({
    mutationFn: (input: { kind: EntryKind; amount: number; reference: string; note: string }) =>
      payoutsService.recordEntry(s.store_id, input),
    onSuccess: (_d, v) => {
      toast.success(`${ENTRY_KIND_LABEL[v.kind]} of ${money(v.amount)} recorded`);
      setKind(null);
    },
    onError: (e) => toast.error(payoutError(e)),
    onSettled: refresh,
  });

  const start = (k: EntryKind) => {
    setKind(k);
    setErrors({});
    setValues({ amount: defaultAmount(k, s).toFixed(2), reference: "", note: "" });
  };

  return (
    <section aria-labelledby="drawer-actions" className="grid gap-2">
      <h3 id="drawer-actions" className="font-semibold">
        Record money movements
      </h3>
      <div className="payout-actions">
        {ACTIONS.map((a) => (
          <Button
            key={a.kind}
            size="sm"
            variant={kind === a.kind ? "default" : "outline"}
            onClick={() => start(a.kind)}
          >
            {a.label}
          </Button>
        ))}
      </div>
      {kind && (
        <form
          className="payout-entry-form"
          noValidate
          aria-label={ACTIONS.find((a) => a.kind === kind)!.label}
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = payoutEntryInputSchema.safeParse({ kind, ...values });
            if (!parsed.success) {
              const next: typeof errors = {};
              for (const i of parsed.error.issues) next[i.path[0] as "amount"] ??= i.message;
              setErrors(next);
              return;
            }
            setErrors({});
            const v = parsed.data;
            setConfirm({
              title: `${ENTRY_KIND_LABEL[v.kind]}: ${money(v.amount)} for ${s.name}?`,
              description:
                v.kind === "payout"
                  ? `Records that ${money(v.amount)} was sent to ${account ? `${account.account_holder} (${maskAccount(account.account_number)})` : "the seller (no payout details on file)"}, reference ${v.reference}. This does not send money.`
                  : v.kind === "cod_offset"
                    ? `Deducts ${money(v.amount)} of COD commission from ${s.name}'s online earnings.`
                    : `Records that ${s.name} paid ${money(v.amount)} of COD commission by transfer.`,
              confirmLabel: v.kind === "payout" ? "Record payout" : "Record",
              run: () =>
                record.mutateAsync({
                  kind: v.kind,
                  amount: v.amount,
                  reference: v.reference ?? "",
                  note: v.note ?? "",
                }),
            });
          }}
        >
          <p className="seller-hint">{ACTIONS.find((a) => a.kind === kind)!.help}</p>
          <div className="seller-field">
            <Label htmlFor="entry-amount">Amount (USD)</Label>
            <Input
              id="entry-amount"
              inputMode="decimal"
              value={values.amount}
              aria-invalid={!!errors.amount}
              aria-describedby={errors.amount ? "entry-amount-error" : undefined}
              onChange={(e) => setValues((v) => ({ ...v, amount: e.target.value }))}
            />
            {errors.amount && (
              <p id="entry-amount-error" className="seller-error">
                {errors.amount}
              </p>
            )}
          </div>
          <div className="seller-field">
            <Label htmlFor="entry-reference">
              Reference{kind === "payout" ? "" : " (optional)"}
            </Label>
            <Input
              id="entry-reference"
              value={values.reference}
              aria-invalid={!!errors.reference}
              aria-describedby={errors.reference ? "entry-reference-error" : undefined}
              onChange={(e) => setValues((v) => ({ ...v, reference: e.target.value }))}
            />
            {errors.reference && (
              <p id="entry-reference-error" className="seller-error">
                {errors.reference}
              </p>
            )}
          </div>
          <div className="seller-field">
            <Label htmlFor="entry-note">Note (optional)</Label>
            <Input
              id="entry-note"
              value={values.note}
              onChange={(e) => setValues((v) => ({ ...v, note: e.target.value }))}
            />
            {errors.note && <p className="seller-error">{errors.note}</p>}
          </div>
          <div className="payout-actions">
            <Button type="submit" disabled={record.isPending}>
              Continue
            </Button>
            <Button type="button" variant="ghost" onClick={() => setKind(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      <ConfirmDialog request={confirm} busy={record.isPending} onClose={() => setConfirm(null)} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Payout settings (Commission tab)
// ---------------------------------------------------------------------------
export function PayoutSettingsPanel() {
  const settings = useQuery({
    queryKey: payoutKeys.settings,
    queryFn: payoutsService.getSettings,
    retry: false,
  });
  // Who/when: the same platform_settings row the commission card reads.
  const who = useQuery({
    queryKey: adminKeys.settings,
    queryFn: financeService.getCommission,
    retry: false,
  });
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: async (v: unknown) => payoutsService.setSettings(v, await currentUserId()),
    onSuccess: () => toast.success("Payout settings saved"),
    onError: (e) => toast.error(payoutError(e)),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: payoutKeys.all }),
        queryClient.invalidateQueries({ queryKey: adminKeys.settings }),
      ]),
  });

  return (
    <section className="seller-card" aria-labelledby="payout-settings-heading">
      <h2 id="payout-settings-heading" className="text-lg font-semibold">
        Payout settings
      </h2>
      <p className="seller-hint mb-4">
        How long online earnings are held, the smallest payout, and the COD debt limit.
      </p>
      {settings.isPending ? (
        <div className="nav-skeleton" aria-busy="true" aria-label="Loading payout settings" />
      ) : settings.isError ? (
        <PayoutLoadError
          what="Payout settings"
          error={settings.error}
          retry={() => void settings.refetch()}
        />
      ) : (
        <PayoutSettingsForm
          key={settings.data.updatedAt ?? "new"}
          initial={settings.data}
          changed={
            who.data
              ? `Last changed ${new Date(who.data.updatedAt).toLocaleString()}${
                  who.data.updatedBy
                    ? ` by ${who.data.updatedBy.isMe ? "you" : (who.data.updatedBy.name ?? who.data.updatedBy.email ?? "a staff member")}`
                    : ""
                }.`
              : settings.data.updatedAt
                ? `Last changed ${new Date(settings.data.updatedAt).toLocaleString()}.`
                : ""
          }
          busy={save.isPending}
          onSave={(v) => save.mutateAsync(v)}
        />
      )}
    </section>
  );
}

const SETTING_FIELDS = [
  { key: "payout_hold_days", label: "Hold after delivery (days)", help: "0 to 60 days." },
  {
    key: "payout_min_amount",
    label: "Minimum payout (USD)",
    help: "Stores below this are not ready to pay.",
  },
  {
    key: "cod_debt_limit",
    label: "COD debt limit (USD)",
    help: "Above this, the store can't take new COD orders.",
  },
] as const;
type SettingKey = (typeof SETTING_FIELDS)[number]["key"];

function PayoutSettingsForm({
  initial,
  changed,
  busy,
  onSave,
}: {
  initial: Record<SettingKey, number>;
  changed: string;
  busy: boolean;
  onSave: (v: unknown) => Promise<unknown>;
}) {
  const [values, setValues] = useState<Record<SettingKey, string>>({
    payout_hold_days: String(initial.payout_hold_days),
    payout_min_amount: String(initial.payout_min_amount),
    cod_debt_limit: String(initial.cod_debt_limit),
  });
  const [errors, setErrors] = useState<Partial<Record<SettingKey, string>>>({});
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  return (
    <form
      className="seller-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = payoutSettingsSchema.safeParse(values);
        if (!parsed.success) {
          const next: Partial<Record<SettingKey, string>> = {};
          for (const i of parsed.error.issues) next[i.path[0] as SettingKey] ??= i.message;
          setErrors(next);
          return;
        }
        setErrors({});
        const v = parsed.data;
        setConfirm({
          title: "Change the payout settings?",
          description: `Hold ${v.payout_hold_days} days, minimum payout ${money(v.payout_min_amount)}, COD debt limit ${money(v.cod_debt_limit)}. This applies to new calculations immediately.`,
          confirmLabel: "Save settings",
          run: () => onSave(v),
        });
      }}
    >
      {SETTING_FIELDS.map((f) => (
        <div key={f.key} className="seller-field">
          <Label htmlFor={`setting-${f.key}`}>{f.label}</Label>
          <Input
            id={`setting-${f.key}`}
            inputMode="decimal"
            className="max-w-40"
            value={values[f.key]}
            aria-invalid={!!errors[f.key]}
            aria-describedby={`setting-${f.key}-help`}
            onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
          />
          <p
            id={`setting-${f.key}-help`}
            className={errors[f.key] ? "seller-error" : "seller-hint"}
          >
            {errors[f.key] ?? f.help}
          </p>
        </div>
      ))}
      {changed && <p className="seller-hint">{changed}</p>}
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save payout settings"}
        </Button>
      </div>
      <ConfirmDialog request={confirm} busy={busy} onClose={() => setConfirm(null)} />
    </form>
  );
}
