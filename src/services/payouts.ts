/**
 * Seller earnings and manual payouts (phase 1, no payment provider).
 *
 * Every number comes from the database (store_earnings, payables_overview…);
 * the app never computes balances itself. Writes go through RPCs that check
 * permissions and limits and refuse with plain messages, shown as they are.
 *
 * Bank details are sensitive: they are never logged, never put in URLs or
 * error reports. Screens show `maskAccount()` unless the owner is editing or
 * finance pressed "Show".
 */
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { expectRows, friendlyError } from "./errors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
/** Numeric columns arrive from PostgREST as strings or numbers. */
const num = z.coerce.number().finite();
const nullableNum = z.preprocess((v) => (v == null ? 0 : v), num);

/** Cents-safe rounding for amounts typed by people. */
export const roundCents = (n: number) => Math.round(n * 100) / 100;

/**
 * "•••• 1234": only the last 4 letters/digits of an account number, never
 * more (and nothing at all for very short values).
 */
export function maskAccount(value: string | null | undefined): string {
  const compact = (value ?? "").replace(/[^A-Za-z0-9]/g, "");
  if (compact.length <= 4) return "••••";
  return `•••• ${compact.slice(-4)}`;
}

/** Errors in plain words; missing database objects say so with the real message. */
export function payoutError(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code && ["PGRST205", "PGRST202", "PGRST200", "42P01", "42883"].includes(err.code))
    return `Payouts aren't set up in the database yet: ${err.message ?? err.code}`;
  // A function's own refusal ("not allowed", limits…) is shown as written.
  if (
    err?.code === "42501" &&
    err.message &&
    !/row-level security|permission denied/i.test(err.message)
  )
    return err.message;
  return friendlyError(e, { "42501": "You don't have permission to do that." });
}

// ---------------------------------------------------------------------------
// Earnings
// ---------------------------------------------------------------------------
export const earningsSchema = z.object({
  currency: z
    .string()
    .nullish()
    .transform((v) => v || "USD"),
  awaiting_delivery: nullableNum,
  in_hold: nullableNum,
  releasable: nullableNum,
  paid_out: nullableNum,
  cod_offset: nullableNum,
  payable: nullableNum,
  cod_commission: nullableNum,
  cod_settled: nullableNum,
  cod_debt: nullableNum,
  hold_days: num,
  min_payout: num,
  cod_debt_limit: num,
  accepting_cod: z.boolean(),
});
export type Earnings = z.output<typeof earningsSchema>;

export const ORDER_STATES = {
  awaiting_delivery: { label: "Awaiting delivery", tone: "neutral" },
  in_hold: { label: "In hold", tone: "info" },
  released: { label: "Released", tone: "good" },
  cod_commission_due: { label: "COD — commission due", tone: "warn" },
  cod_awaiting_delivery: { label: "COD — awaiting delivery", tone: "neutral" },
  not_paid: { label: "Not paid", tone: "muted" },
  refunded: { label: "Refunded", tone: "muted" },
  cancelled: { label: "Cancelled", tone: "muted" },
} as const;
export type OrderState = keyof typeof ORDER_STATES;
export const isOrderState = (v: unknown): v is OrderState =>
  typeof v === "string" && v in ORDER_STATES;

/** Unknown states (a newer database) still render, with their raw name. */
export const stateLabel = (state: string) =>
  isOrderState(state) ? ORDER_STATES[state].label : state.replace(/_/g, " ");
export const stateTone = (state: string) =>
  isOrderState(state) ? ORDER_STATES[state].tone : "neutral";

export const earningsOrderSchema = z.object({
  order_id: z.string(),
  created_at: z.string(),
  payment_provider: z
    .string()
    .nullish()
    .transform((v) => v ?? "cod"),
  total: nullableNum,
  commission_amount: nullableNum,
  seller_amount: nullableNum,
  state: z.string(),
  release_at: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
});
export type EarningsOrder = z.output<typeof earningsOrderSchema>;

/** Orders read at once (filtered and paged in the browser, 50 per page). */
export const EARNINGS_ORDERS_LIMIT = 1000;
export const EARNINGS_PAGE_SIZE = 50;

export const isCod = (provider: string | null | undefined) => (provider ?? "cod") === "cod";

/** The next date money in hold is released (earliest release_at of orders in hold). */
export function nextRelease(orders: Pick<EarningsOrder, "state" | "release_at">[]): string | null {
  const dates = orders
    .filter((o) => o.state === "in_hold" && o.release_at)
    .map((o) => o.release_at!)
    .sort();
  return dates[0] ?? null;
}

export function filterOrders<T extends Pick<EarningsOrder, "state">>(orders: T[], state: string) {
  return state ? orders.filter((o) => o.state === state) : orders;
}

export function pageOf<T>(list: T[], page: number, size = EARNINGS_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const current = Math.min(Math.max(0, page), pages - 1);
  return { rows: list.slice(current * size, current * size + size), page: current, pages };
}

// ---------------------------------------------------------------------------
// Payout history
// ---------------------------------------------------------------------------
export const ENTRY_KINDS = ["payout", "cod_settlement", "cod_offset"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export const ENTRY_KIND_LABEL: Record<EntryKind, string> = {
  payout: "Payout",
  cod_settlement: "COD settled by transfer",
  cod_offset: "COD deducted from earnings",
};
export const entryKindLabel = (kind: string) =>
  (ENTRY_KIND_LABEL as Record<string, string>)[kind] ?? kind;

export const payoutEntrySchema = z.object({
  id: z.string(),
  store_id: z.string(),
  kind: z.string(),
  amount: num,
  currency: z
    .string()
    .nullish()
    .transform((v) => v || "USD"),
  reference: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
  note: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
  created_by: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
  created_at: z.string(),
});
export type PayoutEntry = z.output<typeof payoutEntrySchema>;

// ---------------------------------------------------------------------------
// Payout details (seller_payout_accounts)
// ---------------------------------------------------------------------------
export const PAYOUT_METHODS = ["bank_transfer", "hesabpay", "other"] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];
export const PAYOUT_METHOD_LABEL: Record<PayoutMethod, string> = {
  bank_transfer: "Bank transfer",
  hesabpay: "HesabPay",
  other: "Other",
};
export const methodLabel = (m: string | null | undefined) =>
  m ? ((PAYOUT_METHOD_LABEL as Record<string, string>)[m] ?? m) : "—";

/** Missing or blank → null (optional fields). */
const blankToNull = (v: unknown) =>
  v === undefined || (typeof v === "string" && v.trim() === "") ? null : v;
const text = (label: string, min: number, max: number) =>
  z
    .string({ required_error: `Enter the ${label}.` })
    .trim()
    .min(min, min <= 1 ? `Enter the ${label}.` : `The ${label} looks too short.`)
    .max(max, `The ${label} can be at most ${max} characters.`);

/** The editable columns only (never store_id, verified_*). Mirrors the database rules. */
export const payoutAccountSchema = z
  .object({
    method: z.enum(PAYOUT_METHODS, { errorMap: () => ({ message: "Choose a payout method." }) }),
    account_holder: text("account holder name", 2, 120),
    country: text("country", 2, 80),
    bank_name: z.preprocess(blankToNull, text("bank name", 2, 120).nullable()),
    account_number: z
      .string({ required_error: "Enter the account number." })
      .trim()
      .min(4, "The account number has at least 4 characters.")
      .max(40, "The account number has at most 40 characters.")
      .regex(
        /^[A-Za-z0-9 +-]+$/,
        "Use only letters, numbers, spaces, + and - in the account number.",
      ),
    swift_bic: z.preprocess(
      (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim().toUpperCase()) : v),
      z
        .string()
        .regex(/^[A-Z0-9]{8}([A-Z0-9]{3})?$/, "A SWIFT/BIC code has 8 or 11 letters and numbers.")
        .nullable(),
    ),
    note: z.preprocess(
      blankToNull,
      z.string().trim().max(500, "Keep the note under 500 characters.").nullable(),
    ),
  })
  .superRefine((v, ctx) => {
    if (v.method === "bank_transfer" && !v.bank_name)
      ctx.addIssue({ code: "custom", path: ["bank_name"], message: "Enter the bank name." });
  });
export type PayoutAccountInput = z.input<typeof payoutAccountSchema>;
export type PayoutAccountValues = z.output<typeof payoutAccountSchema>;

export interface PayoutAccount extends PayoutAccountValues {
  store_id: string;
  verified_at: string | null;
  verified_by: string | null;
  updated_at: string | null;
}
const ACCOUNT_COLUMNS =
  "store_id, method, account_holder, country, bank_name, account_number, swift_bic, note, verified_at, verified_by, updated_at";

// ---------------------------------------------------------------------------
// Finance: overview, entries, settings
// ---------------------------------------------------------------------------
export const storePayablesSchema = z.object({
  store_id: z.string(),
  name: z
    .string()
    .nullish()
    .transform((v) => v ?? "Unnamed store"),
  awaiting_delivery: nullableNum,
  in_hold: nullableNum,
  releasable: nullableNum,
  paid_out: nullableNum,
  cod_offset: nullableNum,
  payable: nullableNum,
  cod_commission: nullableNum,
  cod_settled: nullableNum,
  cod_debt: nullableNum,
  ready_to_pay: z.boolean(),
  accepting_cod: z.boolean(),
  account_method: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
  account_verified: z
    .boolean()
    .nullish()
    .transform((v) => !!v),
  has_account: z.boolean(),
});
export type StorePayables = z.output<typeof storePayablesSchema>;

export const payablesOverviewSchema = z.object({
  hold_days: num,
  min_payout: num,
  cod_debt_limit: num,
  stores: z
    .array(storePayablesSchema)
    .nullish()
    .transform((v) => v ?? []),
});
export type PayablesOverview = z.output<typeof payablesOverviewSchema>;

export type PayablesFilter = "" | "ready" | "cod_debt" | "no_account";
export function filterPayables(stores: StorePayables[], filter: PayablesFilter, query = "") {
  const q = query.trim().toLowerCase();
  return stores
    .filter((s) =>
      filter === "ready"
        ? s.ready_to_pay
        : filter === "cod_debt"
          ? s.cod_debt > 0
          : filter === "no_account"
            ? !s.has_account
            : true,
    )
    .filter((s) => !q || s.name.toLowerCase().includes(q))
    .sort((a, b) => b.payable - a.payable || a.name.localeCompare(b.name));
}

export type AccountStatus = "none" | "unverified" | "verified";
export const accountStatus = (s: Pick<StorePayables, "has_account" | "account_verified">) =>
  !s.has_account ? "none" : s.account_verified ? "verified" : "unverified";

/** One payout / settlement / offset as finance types it. */
export const payoutEntryInputSchema = z
  .object({
    kind: z.enum(ENTRY_KINDS, { errorMap: () => ({ message: "Unknown entry type." }) }),
    // Typed text or a number; "" is not 0.
    amount: z.preprocess(
      (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim()) : v),
      z.coerce
        .number({ invalid_type_error: "Enter an amount.", required_error: "Enter an amount." })
        .finite()
        .positive("Enter an amount above 0.")
        .max(1_000_000, "That amount is too large.")
        .refine((v) => roundCents(v) === v, "Use at most two decimals."),
    ),
    reference: z.preprocess(
      blankToNull,
      z.string().trim().max(120, "Keep the reference under 120 characters.").nullable(),
    ),
    note: z.preprocess(
      blankToNull,
      z.string().trim().max(500, "Keep the note under 500 characters.").nullable(),
    ),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "payout" && !v.reference)
      ctx.addIssue({
        code: "custom",
        path: ["reference"],
        message: "Enter the transfer reference (it shows on the seller's history).",
      });
  });
export type PayoutEntryInput = z.input<typeof payoutEntryInputSchema>;

/** Defaults finance starts from: full payable; offset = min(payable, COD debt). */
export function defaultAmount(kind: EntryKind, s: Pick<StorePayables, "payable" | "cod_debt">) {
  if (kind === "payout") return roundCents(s.payable);
  if (kind === "cod_offset") return roundCents(Math.min(s.payable, s.cod_debt));
  return roundCents(s.cod_debt);
}

export const payoutSettingsSchema = z.object({
  payout_hold_days: z.coerce
    .number({ invalid_type_error: "Enter a number of days." })
    .int("Use whole days.")
    .min(0, "Use 0 to 60 days.")
    .max(60, "Use 0 to 60 days."),
  payout_min_amount: z.coerce
    .number({ invalid_type_error: "Enter an amount." })
    .finite()
    .min(0, "Use 0 or more.")
    .max(100_000, "That minimum is too large.")
    .refine((v) => roundCents(v) === v, "Use at most two decimals."),
  cod_debt_limit: z.coerce
    .number({ invalid_type_error: "Enter an amount." })
    .finite()
    .min(0, "Use 0 or more.")
    .max(100_000, "That limit is too large.")
    .refine((v) => roundCents(v) === v, "Use at most two decimals."),
});
export type PayoutSettings = z.output<typeof payoutSettingsSchema>;

// ---------------------------------------------------------------------------
// CSV of ready-to-pay stores (finance only; contains full account numbers)
// ---------------------------------------------------------------------------
/** A spreadsheet must never run a cell as a formula; quotes and commas are escaped. */
export function csvCell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const PAYOUT_CSV_COLUMNS = [
  "store",
  "store_id",
  "payable",
  "currency",
  "method",
  "account_holder",
  "bank_name",
  "account_number",
  "swift_bic",
  "country",
  "verified",
] as const;

export function buildPayoutCsv(
  stores: Pick<StorePayables, "store_id" | "name" | "payable">[],
  accounts: Map<string, PayoutAccount>,
  currency = "USD",
): string {
  const lines = [PAYOUT_CSV_COLUMNS.join(",")];
  for (const s of stores) {
    const a = accounts.get(s.store_id);
    lines.push(
      [
        s.name,
        s.store_id,
        s.payable.toFixed(2),
        currency,
        a?.method ?? "",
        a?.account_holder ?? "",
        a?.bank_name ?? "",
        a?.account_number ?? "",
        a?.swift_bic ?? "",
        a?.country ?? "",
        a ? (a.verified_at ? "yes" : "no") : "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
export interface PayoutSettingsInfo extends PayoutSettings {
  updatedAt: string | null;
  updatedBy: string | null;
}

export const payoutsService = {
  earnings: async (storeId: string): Promise<Earnings> => {
    const { data, error } = await supabase.rpc("store_earnings", { p_store_id: storeId });
    if (error) throw error;
    const value = Array.isArray(data) && data.length === 1 ? data[0] : data;
    return earningsSchema.parse(value);
  },

  /** Order lines with their earnings state, newest first. */
  earningsOrders: async (
    storeId: string,
    limit = EARNINGS_ORDERS_LIMIT,
    offset = 0,
  ): Promise<EarningsOrder[]> => {
    const { data, error } = await supabase.rpc("store_earnings_orders", {
      p_store_id: storeId,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw error;
    return z.array(earningsOrderSchema).parse(data ?? []);
  },

  entries: async (storeId: string): Promise<PayoutEntry[]> => {
    const { data, error } = await supabase
      .from("payout_entries")
      .select("id, store_id, kind, amount, currency, reference, note, created_by, created_at")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return z.array(payoutEntrySchema).parse(data ?? []);
  },

  getAccount: async (storeId: string): Promise<PayoutAccount | null> => {
    const { data, error } = await supabase
      .from("seller_payout_accounts")
      .select(ACCOUNT_COLUMNS)
      .eq("store_id", storeId)
      .maybeSingle();
    if (error) throw error;
    return (data as PayoutAccount | null) ?? null;
  },

  /** Finance: details of several stores (for the payment file). */
  accountsFor: async (storeIds: string[]): Promise<Map<string, PayoutAccount>> => {
    if (!storeIds.length) return new Map();
    const { data, error } = await supabase
      .from("seller_payout_accounts")
      .select(ACCOUNT_COLUMNS)
      .in("store_id", storeIds);
    if (error) throw error;
    return new Map(((data ?? []) as PayoutAccount[]).map((a) => [a.store_id, a]));
  },

  /** Owner: creates or replaces the details. Only editable columns are sent. */
  saveAccount: async (
    storeId: string,
    input: PayoutAccountInput | Record<keyof PayoutAccountInput, string>,
  ): Promise<PayoutAccount> => {
    const v = payoutAccountSchema.parse(input);
    const { data, error } = await supabase
      .from("seller_payout_accounts")
      .upsert(
        {
          store_id: storeId,
          method: v.method,
          account_holder: v.account_holder,
          country: v.country,
          bank_name: v.bank_name,
          account_number: v.account_number,
          swift_bic: v.swift_bic,
          note: v.note,
        },
        { onConflict: "store_id" },
      )
      .select(ACCOUNT_COLUMNS)
      .single();
    if (error) throw error;
    return data as PayoutAccount;
  },

  removeAccount: async (storeId: string): Promise<void> => {
    const { data, error } = await supabase
      .from("seller_payout_accounts")
      .delete()
      .eq("store_id", storeId)
      .select("store_id");
    if (error) throw error;
    expectRows(data, "payout details");
  },

  overview: async (): Promise<PayablesOverview> => {
    const { data, error } = await supabase.rpc("payables_overview");
    if (error) throw error;
    const value = Array.isArray(data) && data.length === 1 ? data[0] : data;
    return payablesOverviewSchema.parse(value);
  },

  /** Records a payout / settlement / offset finance already made. Returns the entry id. */
  recordEntry: async (storeId: string, input: PayoutEntryInput): Promise<string> => {
    const v = payoutEntryInputSchema.parse(input);
    const { data, error } = await supabase.rpc("record_payout_entry", {
      p_store_id: storeId,
      p_kind: v.kind,
      p_amount: v.amount,
      p_reference: v.reference,
      p_note: v.note,
    });
    if (error) throw error;
    return String(data);
  },

  verifyAccount: async (storeId: string, verified: boolean): Promise<void> => {
    const { error } = await supabase.rpc("verify_payout_account", {
      p_store_id: storeId,
      p_verified: verified,
    });
    if (error) throw error;
  },

  getSettings: async (): Promise<PayoutSettingsInfo> => {
    const { data, error } = await supabase
      .from("platform_settings")
      .select("payout_hold_days, payout_min_amount, cod_debt_limit, updated_at, updated_by")
      .eq("id", true)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("The platform settings row is missing.");
    const row = data as Record<string, unknown>;
    return {
      ...payoutSettingsSchema.parse(row),
      updatedAt: (row["updated_at"] as string | null) ?? null,
      updatedBy: (row["updated_by"] as string | null) ?? null,
    };
  },

  setSettings: async (input: unknown, userId: string): Promise<void> => {
    const v = payoutSettingsSchema.parse(input);
    const { data, error } = await supabase
      .from("platform_settings")
      .update({ ...v, updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", true)
      .select("id");
    if (error) throw error;
    expectRows(data, "setting");
  },

  storeAcceptsCod: async (storeId: string): Promise<boolean> => {
    const { data, error } = await supabase.rpc("store_accepts_cod", { p_store_id: storeId });
    if (error) throw error;
    return data !== false;
  },
};

// ---------------------------------------------------------------------------
// Checkout: cash on delivery per store
// ---------------------------------------------------------------------------
export const COD_PAUSED_MESSAGE = "This store is not accepting cash on delivery orders right now";
export const isCodPausedError = (e: unknown) =>
  typeof (e as { message?: unknown } | null)?.message === "string" &&
  (e as { message: string }).message.includes(COD_PAUSED_MESSAGE);

/**
 * Stores in the cart that can't take cash on delivery now. If the check
 * itself fails, nothing is blocked here: the database still refuses such an
 * order, and that error is shown in plain words.
 */
export async function codPausedStores(storeIds: string[]): Promise<string[]> {
  const unique = [...new Set(storeIds)];
  const results = await Promise.all(
    unique.map((id) =>
      payoutsService.storeAcceptsCod(id).then(
        (ok) => (ok ? null : id),
        () => null,
      ),
    ),
  );
  return results.filter((id): id is string => !!id);
}
