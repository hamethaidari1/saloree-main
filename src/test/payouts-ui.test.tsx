import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createSupabaseMock } from "./supabase-mock";
import { renderWithRouter } from "./router-harness";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import {
  AccountFacts,
  EarningsCards,
  EarningsOrdersTable,
  PayoutDetails,
  PayoutHistory,
  PayoutRules,
} from "@/components/seller/payouts-panels";
import type { Earnings, EarningsOrder, PayoutAccount } from "@/services/payouts";

const m = () => mock.current!;
beforeEach(() => {
  m().reset();
  toast.success.mockClear();
  toast.error.mockClear();
});

const STORE = "11111111-1111-4111-8111-111111111111";
const IBAN = "DE89 3704 0044 0532 0130 00";
const earnings = (p: Partial<Earnings> = {}): Earnings => ({
  currency: "USD",
  awaiting_delivery: 40,
  in_hold: 25.5,
  releasable: 60,
  paid_out: 100,
  cod_offset: 5,
  payable: 55,
  cod_commission: 12,
  cod_settled: 0,
  cod_debt: 12,
  hold_days: 7,
  min_payout: 20,
  cod_debt_limit: 50,
  accepting_cod: true,
  ...p,
});
const order = (i: number, p: Partial<EarningsOrder> = {}): EarningsOrder => ({
  order_id: `${String(i).padStart(8, "0")}-0000-4000-8000-000000000000`,
  created_at: "2026-11-10T10:00:00Z",
  payment_provider: "stripe",
  total: 30,
  commission_amount: 3,
  seller_amount: 27,
  state: "released",
  release_at: null,
  ...p,
});
const account = (p: Partial<PayoutAccount> = {}): PayoutAccount => ({
  store_id: STORE,
  method: "bank_transfer",
  account_holder: "Sara Ahmadi",
  country: "Germany",
  bank_name: "Deutsche Bank",
  account_number: IBAN,
  swift_bic: "DEUTDEFF",
  note: null,
  verified_at: null,
  verified_by: null,
  updated_at: "2026-11-10T00:00:00Z",
  ...p,
});

describe("earnings cards", () => {
  it("shows the real balances, the next release date and the COD due separately", () => {
    renderWithRouter(
      <EarningsCards
        e={earnings()}
        orders={[order(1, { state: "in_hold", release_at: "2026-11-20T00:00:00Z" })]}
      />,
    );
    return screen.findByText("Ready to pay out").then(() => {
      expect(screen.getByText("$55.00")).toBeTruthy();
      expect(screen.getByText("$25.50")).toBeTruthy();
      expect(
        screen.getByText(`Next release ${new Date("2026-11-20T00:00:00Z").toLocaleDateString()}`),
      ).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Cash on delivery commission due" })).toBeTruthy();
      expect(screen.getByText("$12.00")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  it("COD paused: a warning with the amount to settle", async () => {
    renderWithRouter(
      <EarningsCards e={earnings({ accepting_cod: false, cod_debt: 62 })} orders={[]} />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "New cash-on-delivery orders are paused until you settle $62.00.",
    );
  });

  it("the rules use the real settings", async () => {
    renderWithRouter(
      <PayoutRules e={earnings({ hold_days: 10, min_payout: 25, cod_debt_limit: 75 })} />,
    );
    const rules = await screen.findByRole("region", { name: "How you get paid" });
    expect(rules).toHaveTextContent("released 10 days after the order is delivered");
    expect(rules).toHaveTextContent("once it reaches $25.00");
    expect(rules).toHaveTextContent("goes above $75.00");
  });
});

describe("orders table", () => {
  it("state badges in words, payment type, release date; filter by state; 50 per page", async () => {
    const list = [
      order(1, { state: "in_hold", release_at: "2026-11-20T00:00:00Z" }),
      order(2, { state: "cod_commission_due", payment_provider: "cod" }),
      ...Array.from({ length: 58 }, (_, i) => order(i + 3)),
    ];
    renderWithRouter(<EarningsOrdersTable orders={list} />);
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(51); // header + 50
    expect(table).toHaveTextContent("In hold");
    expect(table).toHaveTextContent("COD — commission due");
    expect(table).toHaveTextContent("COD");
    expect(screen.getByText("Page 1 of 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(11);
    fireEvent.change(screen.getByRole("combobox", { name: "State" }), {
      target: { value: "in_hold" },
    });
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent(
      `Released ${new Date("2026-11-20T00:00:00Z").toLocaleDateString()}`,
    );
  });

  it("empty store", async () => {
    renderWithRouter(<EarningsOrdersTable orders={[]} />);
    expect(await screen.findByText(/No orders yet/)).toBeTruthy();
  });
});

describe("payout history", () => {
  it("types in words", async () => {
    renderWithRouter(
      <PayoutHistory
        entries={[
          {
            id: "1",
            store_id: STORE,
            kind: "payout",
            amount: 55,
            currency: "USD",
            reference: "TR-1",
            note: null,
            created_by: null,
            created_at: "2026-11-12",
          },
          {
            id: "2",
            store_id: STORE,
            kind: "cod_settlement",
            amount: 12,
            currency: "USD",
            reference: null,
            note: null,
            created_by: null,
            created_at: "2026-11-11",
          },
          {
            id: "3",
            store_id: STORE,
            kind: "cod_offset",
            amount: 5,
            currency: "USD",
            reference: null,
            note: null,
            created_by: null,
            created_at: "2026-11-10",
          },
        ]}
      />,
    );
    const table = await screen.findByRole("table");
    expect(table).toHaveTextContent("Payout");
    expect(table).toHaveTextContent("COD settled by transfer");
    expect(table).toHaveTextContent("COD deducted from earnings");
    expect(table).toHaveTextContent("TR-1");
  });
});

describe("payout details", () => {
  it("masked when not editing — the full number is nowhere in the markup", async () => {
    m().state.queue.push({ data: account() });
    const { container } = renderWithRouter(
      <PayoutDetails storeId={STORE} payable={55} currency="USD" />,
    );
    expect(await screen.findByText("•••• 3000")).toBeTruthy();
    expect(container.innerHTML).not.toContain("3704");
    expect(container.innerHTML).not.toContain("DE89");
    expect(screen.getByText("Not verified yet")).toBeTruthy();
  });

  it("edit shows the owner's own number; saving sends the details", async () => {
    m().state.queue.push({ data: account({ verified_at: "2026-11-11T00:00:00Z" }) });
    renderWithRouter(<PayoutDetails storeId={STORE} payable={0} currency="USD" />);
    expect(await screen.findByText("Verified")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit details" }));
    expect(screen.getByLabelText("IBAN / account number")).toHaveValue(IBAN);
    expect(screen.getByRole("note")).toHaveTextContent("Saving changes removes the verification");
    fireEvent.change(screen.getByLabelText("SWIFT/BIC (optional)"), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: "Save payout details" }));
    expect(
      await screen.findByText("A SWIFT/BIC code has 8 or 11 letters and numbers."),
    ).toBeTruthy();
    expect(m().callsOn("seller_payout_accounts", 1)).toEqual([]);
    fireEvent.change(screen.getByLabelText("SWIFT/BIC (optional)"), {
      target: { value: "deutdeffxxx" },
    });
    m().state.queue.push({ data: account() });
    fireEvent.click(screen.getByRole("button", { name: "Save payout details" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Payout details saved"));
    const upsert = m()
      .state.queries.filter((q) => q.table === "seller_payout_accounts")
      .flatMap((q) => q.calls)
      .find((c) => c[0] === "upsert")![1] as Record<string, unknown>;
    expect(upsert).toMatchObject({
      store_id: STORE,
      swift_bic: "DEUTDEFFXXX",
      account_number: IBAN,
    });
    expect(upsert).not.toHaveProperty("verified_at");
  });

  it("no details yet but money is ready → prominent hint; HesabPay asks for a wallet number", async () => {
    m().state.queue.push({ data: null });
    renderWithRouter(<PayoutDetails storeId={STORE} payable={55} currency="USD" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "You have $55.00 ready to pay out. Add your payout details",
    );
    fireEvent.click(screen.getByRole("button", { name: "Add payout details" }));
    fireEvent.change(screen.getByLabelText("Payout method"), { target: { value: "hesabpay" } });
    expect(screen.getByLabelText("HesabPay wallet number")).toBeTruthy();
    expect(screen.queryByLabelText("Bank name")).toBeNull();
  });

  it("remove asks first", async () => {
    m().state.queue.push({ data: account() });
    renderWithRouter(<PayoutDetails storeId={STORE} payable={0} currency="USD" />);
    fireEvent.click(await screen.findByRole("button", { name: "Remove details" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Saloree can't pay you until you add details again.");
    m().state.queue.push({ data: [{ store_id: STORE }] });
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove details" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Payout details removed"));
    expect(
      m().state.queries.some(
        (q) => q.table === "seller_payout_accounts" && q.calls.some((c) => c[0] === "delete"),
      ),
    ).toBe(true);
  });

  it("a missing table shows the real database error", async () => {
    m().state.queue.push({
      error: {
        code: "PGRST205",
        message: "Could not find the table 'public.seller_payout_accounts'",
      },
    });
    renderWithRouter(<PayoutDetails storeId={STORE} payable={0} currency="USD" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Payouts aren't set up in the database yet: Could not find the table 'public.seller_payout_accounts'",
    );
  });

  it("finance facts: masked unless revealed", async () => {
    const { container, unmount } = renderWithRouter(<AccountFacts account={account()} />);
    await screen.findByText("•••• 3000");
    expect(container.innerHTML).not.toContain("3704");
    unmount();
    renderWithRouter(<AccountFacts account={account()} reveal copyable />);
    expect(await screen.findByText(IBAN)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy account number / iban" })).toBeTruthy();
  });
});
