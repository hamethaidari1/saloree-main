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
const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  download: vi.fn(),
  reads: {
    overview: vi.fn(),
    earningsOrders: vi.fn(),
    entries: vi.fn(),
    getAccount: vi.fn(),
    accountsFor: vi.fn(),
    getSettings: vi.fn(),
  },
  commission: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/lib/download", () => ({ downloadText: h.download }));
vi.mock("@/services/payouts", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/services/payouts")>();
  // Reads are stubbed; writes (recordEntry, verifyAccount, setSettings) are the real ones.
  return { ...real, payoutsService: { ...real.payoutsService, ...h.reads } };
});
vi.mock("@/services/finance", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/services/finance")>();
  return { ...real, financeService: { ...real.financeService, getCommission: h.commission } };
});

import { PayoutSettingsPanel, PayoutsFinancePanel } from "@/components/staff/payouts-finance";
import type { PayoutAccount, StorePayables } from "@/services/payouts";

const m = () => mock.current!;
const IBAN = "DE89 3704 0044 0532 0130 00";
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const store = (p: Partial<StorePayables>): StorePayables => ({
  store_id: A,
  name: "Alpha",
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
const account: PayoutAccount = {
  store_id: B,
  method: "bank_transfer",
  account_holder: "Beta LLC",
  country: "Germany",
  bank_name: "Bank",
  account_number: IBAN,
  swift_bic: null,
  note: null,
  verified_at: null,
  verified_by: null,
  updated_at: null,
};

beforeEach(() => {
  m().reset();
  for (const f of Object.values(h.reads)) f.mockReset();
  h.toast.success.mockClear();
  h.toast.error.mockClear();
  h.download.mockClear();
  h.reads.overview.mockResolvedValue({
    hold_days: 7,
    min_payout: 20,
    cod_debt_limit: 50,
    stores: [
      store({ store_id: A, name: "Alpha", payable: 10, cod_debt: 60, accepting_cod: false }),
      store({
        store_id: B,
        name: "Beta",
        payable: 55,
        cod_debt: 12,
        ready_to_pay: true,
        has_account: true,
        account_method: "bank_transfer",
      }),
    ],
  });
  h.reads.earningsOrders.mockResolvedValue([]);
  h.reads.entries.mockResolvedValue([]);
  h.reads.getAccount.mockResolvedValue(account);
  h.reads.accountsFor.mockResolvedValue(new Map([[B, account]]));
});

const openStore = async (name: string) => {
  renderWithRouter(<PayoutsFinancePanel />);
  fireEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("dialog", { name });
};

describe("Payouts tab", () => {
  it("stores sorted by payable, with account status and badges; filters", async () => {
    renderWithRouter(<PayoutsFinancePanel />);
    const table = await screen.findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => r.querySelector("td")!.textContent)).toEqual(["Beta", "Alpha"]);
    expect(rows[0]).toHaveTextContent("Ready to pay");
    expect(rows[0]).toHaveTextContent("Unverified · Bank transfer");
    expect(rows[1]).toHaveTextContent("COD blocked");
    expect(rows[1]).toHaveTextContent("No details");
    expect(screen.getByRole("note")).toHaveTextContent("Recording a payout does NOT send money");
    fireEvent.change(screen.getByRole("combobox", { name: "Show" }), {
      target: { value: "no_account" },
    });
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(2);
  });

  it("real database error when payouts aren't set up", async () => {
    h.reads.overview.mockRejectedValue({
      code: "PGRST202",
      message: "Could not find the function public.payables_overview",
    });
    renderWithRouter(<PayoutsFinancePanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Payouts aren't set up in the database yet: Could not find the function public.payables_overview",
    );
  });

  it("drawer: details masked until 'Show'; copy buttons; verify with confirm", async () => {
    const drawer = await openStore("Beta");
    expect(await within(drawer).findByText("•••• 3000")).toBeTruthy();
    expect(drawer.innerHTML).not.toContain("3704");
    fireEvent.click(within(drawer).getByRole("button", { name: "Show account number" }));
    expect(within(drawer).getByText(IBAN)).toBeTruthy();
    expect(within(drawer).getByRole("button", { name: "Copy account holder" })).toBeTruthy();
    fireEvent.click(within(drawer).getByRole("button", { name: "Verify details" }));
    const ask = await screen.findByRole("alertdialog");
    expect(ask).toHaveTextContent("Beta LLC (•••• 3000) belongs to Beta");
    fireEvent.click(within(ask).getByRole("button", { name: "Verify details" }));
    await waitFor(() =>
      expect(m().state.rpcs).toContainEqual({
        fn: "verify_payout_account",
        args: { p_store_id: B, p_verified: true },
      }),
    );
  });

  it("record payout: full payable by default, reference required, confirm repeats store/amount/masked account", async () => {
    const drawer = await openStore("Beta");
    fireEvent.click(await within(drawer).findByRole("button", { name: "Record payout" }));
    const form = within(drawer).getByRole("form", { name: "Record payout" });
    expect(within(form).getByLabelText("Amount (USD)")).toHaveValue("55.00");
    fireEvent.click(within(form).getByRole("button", { name: "Continue" }));
    expect(await within(form).findByText(/Enter the transfer reference/)).toBeTruthy();
    fireEvent.change(within(form).getByLabelText("Reference"), { target: { value: "TR-2026-11" } });
    fireEvent.click(within(form).getByRole("button", { name: "Continue" }));
    const ask = await screen.findByRole("alertdialog");
    expect(ask).toHaveTextContent("Payout: $55.00 for Beta?");
    expect(ask).toHaveTextContent(
      "Beta LLC (•••• 3000), reference TR-2026-11. This does not send money.",
    );
    expect(ask.innerHTML).not.toContain("3704");
    m().state.queue.push({ data: "entry-1" });
    fireEvent.click(within(ask).getByRole("button", { name: "Record payout" }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("Payout of $55.00 recorded"));
    expect(m().state.rpcs.at(-1)).toEqual({
      fn: "record_payout_entry",
      args: {
        p_store_id: B,
        p_kind: "payout",
        p_amount: 55,
        p_reference: "TR-2026-11",
        p_note: null,
      },
    });
  });

  it("an amount above the balance: the database's message is shown as it is", async () => {
    const drawer = await openStore("Beta");
    fireEvent.click(await within(drawer).findByRole("button", { name: "Record payout" }));
    const form = within(drawer).getByRole("form", { name: "Record payout" });
    fireEvent.change(within(form).getByLabelText("Amount (USD)"), { target: { value: "80" } });
    fireEvent.change(within(form).getByLabelText("Reference"), { target: { value: "TR-1" } });
    fireEvent.click(within(form).getByRole("button", { name: "Continue" }));
    m().state.queue.push({
      error: { code: "P0001", message: "Amount is more than the payable balance (55.00)" },
    });
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Record payout" }),
    );
    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith("Amount is more than the payable balance (55.00)"),
    );
  });

  it("offset defaults to min(payable, COD debt); settlement to the COD debt", async () => {
    const drawer = await openStore("Beta");
    fireEvent.click(
      await within(drawer).findByRole("button", { name: "Offset COD debt from earnings" }),
    );
    expect(within(drawer).getByLabelText("Amount (USD)")).toHaveValue("12.00");
    expect(within(drawer).getByLabelText("Reference (optional)")).toBeTruthy();
    fireEvent.click(within(drawer).getByRole("button", { name: "Record COD settlement" }));
    expect(within(drawer).getByLabelText("Amount (USD)")).toHaveValue("12.00");
  });

  it("payment file: warns that it holds full account numbers, then downloads them", async () => {
    renderWithRouter(<PayoutsFinancePanel />);
    fireEvent.click(
      await screen.findByRole("button", { name: /Download CSV of ready-to-pay stores/ }),
    );
    const ask = await screen.findByRole("alertdialog");
    expect(ask).toHaveTextContent("FULL account numbers");
    expect(ask).toHaveTextContent("Only finance and admins can download it");
    fireEvent.click(within(ask).getByRole("button", { name: "Download CSV" }));
    await waitFor(() => expect(h.download).toHaveBeenCalled());
    expect(h.reads.accountsFor).toHaveBeenCalledWith([B]); // ready-to-pay stores only
    const [name, csv] = h.download.mock.calls[0]!;
    expect(name).toMatch(/^saloree-payouts-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv).toContain(IBAN);
    expect(csv).not.toContain("Alpha");
  });
});

describe("Payout settings", () => {
  beforeEach(() => {
    h.reads.getSettings.mockResolvedValue({
      payout_hold_days: 7,
      payout_min_amount: 20,
      cod_debt_limit: 50,
      updatedAt: "2026-11-10T10:00:00Z",
      updatedBy: "user-1",
    });
    h.commission.mockResolvedValue({
      percent: 10,
      updatedAt: "2026-11-10T10:00:00Z",
      updatedBy: { id: "user-1", name: "Omar", email: "o@x.io", isMe: true },
    });
  });

  it("validates, confirms 'applies immediately', saves with who changed it", async () => {
    renderWithRouter(<PayoutSettingsPanel />);
    const hold = await screen.findByLabelText("Hold after delivery (days)");
    expect(hold).toHaveValue("7");
    expect(await screen.findByText(/Last changed .* by you\./)).toBeTruthy();
    fireEvent.change(hold, { target: { value: "90" } });
    fireEvent.click(screen.getByRole("button", { name: "Save payout settings" }));
    expect(await screen.findByText("Use 0 to 60 days.")).toBeTruthy();
    fireEvent.change(hold, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save payout settings" }));
    const ask = await screen.findByRole("alertdialog");
    expect(ask).toHaveTextContent("applies to new calculations immediately");
    m().state.queue.push({ data: [{ id: true }] });
    fireEvent.click(within(ask).getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("Payout settings saved"));
    const update = m()
      .callsOn("platform_settings")
      .find((c) => c[0] === "update")![1];
    expect(update).toMatchObject({
      payout_hold_days: 10,
      payout_min_amount: 20,
      cod_debt_limit: 50,
      updated_by: "user-1",
    });
  });
});
