import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "./supabase-mock";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

import {
  accountStatus,
  buildPayoutCsv,
  codPausedStores,
  csvCell,
  defaultAmount,
  entryKindLabel,
  filterOrders,
  filterPayables,
  isCodPausedError,
  maskAccount,
  nextRelease,
  pageOf,
  payoutAccountSchema,
  payoutEntryInputSchema,
  payoutError,
  payoutSettingsSchema,
  payoutsService,
  stateLabel,
  stateTone,
  type PayoutAccount,
  type StorePayables,
} from "@/services/payouts";
import { money } from "@/services/catalog";

const m = () => mock.current!;
beforeEach(() => m().reset());
afterEach(() => vi.restoreAllMocks());

const STORE = "11111111-1111-4111-8111-111111111111";
const IBAN = "DE89 3704 0044 0532 0130 00";

const earningsRow = {
  currency: "USD",
  awaiting_delivery: "40.00",
  in_hold: "25.5",
  releasable: 60,
  paid_out: "100",
  cod_offset: 5,
  payable: "55.00",
  cod_commission: "12",
  cod_settled: "0",
  cod_debt: "12.00",
  hold_days: 7,
  min_payout: "20",
  cod_debt_limit: "50",
  accepting_cod: true,
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
describe("maskAccount", () => {
  it.each([
    [IBAN, "•••• 3000"],
    ["AF12-3456-7890", "•••• 7890"],
    ["+93 70 123 4567", "•••• 4567"],
    ["12345", "•••• 2345"],
    ["1234", "••••"], // short values show nothing
    ["", "••••"],
    [null, "••••"],
  ])("%j → %j", (value, out) => expect(maskAccount(value)).toBe(out));

  it("never shows more than the last 4 characters", () => {
    const masked = maskAccount(IBAN);
    expect(masked.replace(/[^A-Za-z0-9]/g, "")).toHaveLength(4);
    expect(masked).not.toContain("3704");
  });
});

describe("money formatting", () => {
  it("USD with two decimals; unknown currency still shows the amount", () => {
    expect(money(55)).toBe("$55.00");
    expect(money(1234.5, "USD")).toBe("$1,234.50");
    expect(money(3, "XYZ")).toMatch(/3\.00/);
  });
});

describe("order states", () => {
  it("readable labels and tones; unknown states still render", () => {
    expect(stateLabel("in_hold")).toBe("In hold");
    expect(stateLabel("cod_commission_due")).toBe("COD — commission due");
    expect(stateTone("released")).toBe("good");
    expect(stateLabel("some_new_state")).toBe("some new state");
    expect(stateTone("some_new_state")).toBe("neutral");
  });
  it("next release is the earliest release date of orders in hold", () => {
    expect(
      nextRelease([
        { state: "in_hold", release_at: "2026-11-20T00:00:00Z" },
        { state: "released", release_at: "2026-11-01T00:00:00Z" },
        { state: "in_hold", release_at: "2026-11-18T00:00:00Z" },
        { state: "in_hold", release_at: null },
      ]),
    ).toBe("2026-11-18T00:00:00Z");
    expect(nextRelease([])).toBeNull();
  });
  it("filter by state and page 50 at a time", () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      state: i % 2 ? "in_hold" : "released",
      i,
    }));
    expect(filterOrders(rows, "in_hold")).toHaveLength(60);
    expect(filterOrders(rows, "")).toHaveLength(120);
    const p = pageOf(rows, 2);
    expect(p).toMatchObject({ page: 2, pages: 3 });
    expect(p.rows).toHaveLength(20);
    expect(pageOf(rows, 99).page).toBe(2);
    expect(pageOf([], 0)).toEqual({ rows: [], page: 0, pages: 1 });
  });
  it("entry types in words", () => {
    expect(entryKindLabel("payout")).toBe("Payout");
    expect(entryKindLabel("cod_settlement")).toBe("COD settled by transfer");
    expect(entryKindLabel("cod_offset")).toBe("COD deducted from earnings");
  });
});

describe("payout details validation (mirrors the database)", () => {
  const base = {
    method: "bank_transfer",
    account_holder: "Sara Ahmadi",
    country: "Germany",
    bank_name: "Deutsche Bank",
    account_number: IBAN,
    swift_bic: "deutdeff",
    note: "",
  };
  it("valid bank details; SWIFT upper-cased; empty note → null", () => {
    expect(payoutAccountSchema.parse(base)).toMatchObject({
      swift_bic: "DEUTDEFF",
      note: null,
      account_number: IBAN,
    });
  });
  it("bank name is required for bank transfer only", () => {
    expect(
      payoutAccountSchema.safeParse({ ...base, bank_name: "" }).error?.issues[0]?.message,
    ).toBe("Enter the bank name.");
    expect(
      payoutAccountSchema.safeParse({ ...base, method: "hesabpay", bank_name: "", swift_bic: "" })
        .success,
    ).toBe(true);
  });
  it.each([
    ["123", /at least 4/],
    ["1".repeat(41), /at most 40/],
    ["DE89_3704", /letters, numbers, spaces, \+ and -/],
  ])("account number %j is refused", (account_number, msg) => {
    expect(
      payoutAccountSchema.safeParse({ ...base, account_number }).error?.issues[0]?.message,
    ).toMatch(msg);
  });
  it.each(["DEUTDE", "DEUTDEFF5", "DEUT-DEFF"])("SWIFT %j is refused (8 or 11)", (swift_bic) => {
    expect(payoutAccountSchema.safeParse({ ...base, swift_bic }).success).toBe(false);
  });
  it("11-character SWIFT is fine; unknown method refused", () => {
    expect(payoutAccountSchema.safeParse({ ...base, swift_bic: "DEUTDEFF500" }).success).toBe(true);
    expect(payoutAccountSchema.safeParse({ ...base, method: "paypal" }).success).toBe(false);
  });
});

describe("finance inputs", () => {
  it("payout needs a reference; amounts > 0 with 2 decimals", () => {
    expect(
      payoutEntryInputSchema.safeParse({ kind: "payout", amount: "20" }).error?.issues[0]?.message,
    ).toMatch(/reference/);
    expect(payoutEntryInputSchema.parse({ kind: "cod_offset", amount: "12.5" })).toMatchObject({
      amount: 12.5,
      reference: null,
    });
    expect(
      payoutEntryInputSchema.safeParse({ kind: "payout", amount: "0", reference: "T1" }).success,
    ).toBe(false);
    expect(
      payoutEntryInputSchema.safeParse({ kind: "payout", amount: "1.005", reference: "T1" })
        .success,
    ).toBe(false);
    expect(payoutEntryInputSchema.safeParse({ kind: "refund", amount: "1" }).success).toBe(false);
  });
  it("defaults: full payable; offset = min(payable, COD debt); settlement = COD debt", () => {
    const s = { payable: 55, cod_debt: 12 };
    expect(defaultAmount("payout", s)).toBe(55);
    expect(defaultAmount("cod_offset", s)).toBe(12);
    expect(defaultAmount("cod_offset", { payable: 8, cod_debt: 12 })).toBe(8);
    expect(defaultAmount("cod_settlement", s)).toBe(12);
  });
  it("settings: hold 0–60 whole days, amounts ≥ 0", () => {
    expect(
      payoutSettingsSchema.parse({
        payout_hold_days: "7",
        payout_min_amount: "20",
        cod_debt_limit: "50",
      }),
    ).toEqual({
      payout_hold_days: 7,
      payout_min_amount: 20,
      cod_debt_limit: 50,
    });
    expect(
      payoutSettingsSchema.safeParse({
        payout_hold_days: 61,
        payout_min_amount: 20,
        cod_debt_limit: 50,
      }).success,
    ).toBe(false);
    expect(
      payoutSettingsSchema.safeParse({
        payout_hold_days: 1.5,
        payout_min_amount: 20,
        cod_debt_limit: 50,
      }).success,
    ).toBe(false);
    expect(
      payoutSettingsSchema.safeParse({
        payout_hold_days: 7,
        payout_min_amount: -1,
        cod_debt_limit: 50,
      }).success,
    ).toBe(false);
  });
});

describe("payables filters", () => {
  const store = (p: Partial<StorePayables>): StorePayables => ({
    store_id: "s",
    name: "Store",
    awaiting_delivery: 0,
    in_hold: 0,
    releasable: 0,
    paid_out: 0,
    cod_offset: 0,
    payable: 0,
    cod_commission: 0,
    cod_settled: 0,
    cod_debt: 0,
    ready_to_pay: false,
    accepting_cod: true,
    account_method: null,
    account_verified: false,
    has_account: false,
    ...p,
  });
  const list = [
    store({ store_id: "a", name: "Alpha", payable: 10 }),
    store({
      store_id: "b",
      name: "Beta",
      payable: 80,
      ready_to_pay: true,
      has_account: true,
      account_verified: true,
    }),
    store({ store_id: "c", name: "Gamma", cod_debt: 60, accepting_cod: false, has_account: true }),
  ];
  it("ready / COD debt / no account; sorted by payable", () => {
    expect(filterPayables(list, "").map((s) => s.store_id)).toEqual(["b", "a", "c"]);
    expect(filterPayables(list, "ready").map((s) => s.store_id)).toEqual(["b"]);
    expect(filterPayables(list, "cod_debt").map((s) => s.store_id)).toEqual(["c"]);
    expect(filterPayables(list, "no_account").map((s) => s.store_id)).toEqual(["a"]);
    expect(filterPayables(list, "", "gam").map((s) => s.store_id)).toEqual(["c"]);
  });
  it("account status", () => {
    expect(list.map(accountStatus)).toEqual(["none", "verified", "unverified"]);
  });
});

describe("payment file (finance)", () => {
  const account = (p: Partial<PayoutAccount> = {}): PayoutAccount => ({
    store_id: "b",
    method: "bank_transfer",
    account_holder: "Beta, LLC",
    country: "Germany",
    bank_name: "Bank",
    account_number: IBAN,
    swift_bic: null,
    note: null,
    verified_at: "2026-11-01T00:00:00Z",
    verified_by: "u",
    updated_at: null,
    ...p,
  });
  it("one line per store with the full account number (finance needs it to pay)", () => {
    const csv = buildPayoutCsv(
      [{ store_id: "b", name: "Beta", payable: 80 }],
      new Map([["b", account()]]),
    );
    const [header, line] = csv.trim().split("\r\n");
    expect(header).toBe(
      "store,store_id,payable,currency,method,account_holder,bank_name,account_number,swift_bic,country,verified",
    );
    expect(line).toBe(`Beta,b,80.00,USD,bank_transfer,"Beta, LLC",Bank,${IBAN},,Germany,yes`);
  });
  it("cells can never run as spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("+93 70 123")).toBe("'+93 70 123");
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe("");
  });
});

describe("errors", () => {
  it("database refusals are shown as they are", () => {
    expect(
      payoutError({ code: "P0001", message: "Amount is more than the payable balance (55.00)" }),
    ).toBe("Amount is more than the payable balance (55.00)");
    expect(payoutError({ code: "P0001", message: "Minimum payout is 20.00" })).toBe(
      "Minimum payout is 20.00",
    );
    expect(payoutError({ code: "42501", message: "Not allowed" })).toBe("Not allowed");
    expect(
      payoutError({ code: "42501", message: "new row violates row-level security policy" }),
    ).toBe("You don't have permission to do that.");
  });
  it("missing database objects name the real error", () => {
    expect(
      payoutError({
        code: "PGRST202",
        message: "Could not find the function public.store_earnings",
      }),
    ).toBe(
      "Payouts aren't set up in the database yet: Could not find the function public.store_earnings",
    );
  });
  it("checkout recognises the database's COD message", () => {
    expect(
      isCodPausedError({
        message: "This store is not accepting cash on delivery orders right now",
      }),
    ).toBe(true);
    expect(isCodPausedError({ message: "other" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Service calls
// ---------------------------------------------------------------------------
describe("payoutsService", () => {
  it("earnings: RPC with the store id; numbers coerced", async () => {
    m().state.queue.push({ data: earningsRow });
    const e = await payoutsService.earnings(STORE);
    expect(m().state.rpcs).toEqual([{ fn: "store_earnings", args: { p_store_id: STORE } }]);
    expect(e).toMatchObject({
      payable: 55,
      in_hold: 25.5,
      cod_debt: 12,
      hold_days: 7,
      min_payout: 20,
      accepting_cod: true,
    });
  });

  it("earnings: an unexpected shape is an error, not zeros", async () => {
    m().state.queue.push({ data: { payable: 1 } });
    await expect(payoutsService.earnings(STORE)).rejects.toThrow();
  });

  it("earnings orders: limit/offset passed; rows parsed", async () => {
    m().state.queue.push({
      data: [
        {
          order_id: "o1",
          created_at: "2026-11-10T00:00:00Z",
          payment_provider: "stripe",
          total: "30",
          commission_amount: "3",
          seller_amount: "27",
          state: "in_hold",
          release_at: "2026-11-17T00:00:00Z",
        },
      ],
    });
    const rows = await payoutsService.earningsOrders(STORE);
    expect(m().state.rpcs[0]).toEqual({
      fn: "store_earnings_orders",
      args: { p_store_id: STORE, p_limit: 1000, p_offset: 0 },
    });
    expect(rows[0]).toMatchObject({ total: 30, seller_amount: 27, state: "in_hold" });
  });

  it("entries: the store's history, newest first", async () => {
    m().state.queue.push({
      data: [
        {
          id: "e1",
          store_id: STORE,
          kind: "payout",
          amount: "55",
          currency: "USD",
          reference: "TR-1",
          note: null,
          created_by: "f",
          created_at: "2026-11-12",
        },
      ],
    });
    const list = await payoutsService.entries(STORE);
    expect(list[0]).toMatchObject({ amount: 55, reference: "TR-1" });
    expect(m().callsOn("payout_entries")).toContainEqual(["eq", "store_id", STORE]);
    expect(m().callsOn("payout_entries")).toContainEqual([
      "order",
      "created_at",
      { ascending: false },
    ]);
  });

  it("save details: only editable columns (never verified_*), upsert per store", async () => {
    m().state.queue.push({ data: { store_id: STORE } });
    await payoutsService.saveAccount(STORE, {
      method: "bank_transfer",
      account_holder: "Sara Ahmadi",
      country: "Germany",
      bank_name: "Deutsche Bank",
      account_number: IBAN,
      swift_bic: "",
      note: "",
    });
    const [op, payload, opts] = m().callsOn("seller_payout_accounts")[0]!;
    expect(op).toBe("upsert");
    expect(Object.keys(payload as object).sort()).toEqual([
      "account_holder",
      "account_number",
      "bank_name",
      "country",
      "method",
      "note",
      "store_id",
      "swift_bic",
    ]);
    expect(opts).toEqual({ onConflict: "store_id" });
  });

  it("save details never logs the account number", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) =>
      vi.spyOn(console, k),
    );
    m().state.queue.push({ error: { code: "23514", message: "check violation" } });
    await expect(
      payoutsService.saveAccount(STORE, {
        method: "hesabpay",
        account_holder: "Sara",
        country: "Afghanistan",
        account_number: "+93 70 123 4567",
      }),
    ).rejects.toBeTruthy();
    for (const s of spies)
      for (const call of s.mock.calls) expect(JSON.stringify(call)).not.toContain("4567");
  });

  it("remove details: refused silently by RLS → error", async () => {
    await expect(payoutsService.removeAccount(STORE)).rejects.toMatchObject({ code: "42501" });
    m().state.queue.push({ data: [{ store_id: STORE }] });
    await expect(payoutsService.removeAccount(STORE)).resolves.toBeUndefined();
  });

  it("overview parses stores; record entry sends the RPC args; errors pass through", async () => {
    m().state.queue.push({
      data: {
        hold_days: 7,
        min_payout: 20,
        cod_debt_limit: 50,
        stores: [
          {
            store_id: STORE,
            name: "Alpha",
            awaiting_delivery: 0,
            in_hold: "5",
            releasable: 60,
            paid_out: 0,
            cod_offset: 0,
            payable: "60",
            cod_commission: 0,
            cod_settled: 0,
            cod_debt: 0,
            ready_to_pay: true,
            accepting_cod: true,
            account_method: "bank_transfer",
            account_verified: null,
            has_account: true,
          },
        ],
      },
    });
    const o = await payoutsService.overview();
    expect(o.stores[0]).toMatchObject({ payable: 60, account_verified: false });

    m().state.queue.push({ data: "entry-uuid" });
    expect(
      await payoutsService.recordEntry(STORE, {
        kind: "payout",
        amount: "60",
        reference: " TR-9 ",
      }),
    ).toBe("entry-uuid");
    expect(m().state.rpcs.at(-1)).toEqual({
      fn: "record_payout_entry",
      args: {
        p_store_id: STORE,
        p_kind: "payout",
        p_amount: 60,
        p_reference: "TR-9",
        p_note: null,
      },
    });

    m().state.queue.push({
      error: { code: "P0001", message: "Amount is more than the payable balance (60.00)" },
    });
    await expect(
      payoutsService.recordEntry(STORE, { kind: "payout", amount: "61", reference: "x" }),
    ).rejects.toMatchObject({
      message: "Amount is more than the payable balance (60.00)",
    });
  });

  it("verify and settings", async () => {
    await payoutsService.verifyAccount(STORE, true);
    expect(m().state.rpcs[0]).toEqual({
      fn: "verify_payout_account",
      args: { p_store_id: STORE, p_verified: true },
    });
    m().state.queue.push({ data: [{ id: true }] });
    await payoutsService.setSettings(
      { payout_hold_days: "10", payout_min_amount: "25", cod_debt_limit: "40" },
      "user-1",
    );
    const update = m()
      .callsOn("platform_settings")
      .find((c) => c[0] === "update")![1];
    expect(update).toMatchObject({
      payout_hold_days: 10,
      payout_min_amount: 25,
      cod_debt_limit: 40,
      updated_by: "user-1",
    });
  });

  it("COD check per store; a failing check never blocks (the database still refuses)", async () => {
    m().state.queue.push(
      { data: true },
      { data: false },
      { error: { code: "PGRST202", message: "missing" } },
    );
    expect(await codPausedStores(["a", "b", "a", "c"])).toEqual(["b"]);
    expect(m().state.rpcs.map((r) => r.args)).toEqual([
      { p_store_id: "a" },
      { p_store_id: "b" },
      { p_store_id: "c" },
    ]);
  });
});
