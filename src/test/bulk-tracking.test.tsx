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

const spies = vi.hoisted(() => ({
  getOrders: vi.fn(),
  forOrders: vi.fn(),
  activeCarriers: vi.fn(),
}));
vi.mock("@/services/seller", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/services/seller")>();
  return { ...real, sellerService: { ...real.sellerService, getOrders: spies.getOrders } };
});
vi.mock("@/services/shipping", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/services/shipping")>();
  return {
    ...real,
    // Reads are stubbed; `add` is the real one (writes go to the Supabase mock).
    shippingService: {
      ...real.shippingService,
      forOrders: spies.forOrders,
      activeCarriers: spies.activeCarriers,
    },
  };
});

import {
  applyPasteFill,
  bulkTrackingNumberSchema,
  fillEmptyCarriers,
  parsePastedNumbers,
  planPasteFill,
  saveTrackingRows,
  shippableOrders,
  validateRows,
  type DraftRow,
} from "@/services/bulk-tracking";
import { BulkTracking } from "@/components/seller/bulk-tracking";
import type { CarrierRow, StoreRow } from "@/data/db";
import type { SellerOrder } from "@/services/seller";

const m = () => mock.current!;
const DHL = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const UPS = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const carriers: CarrierRow[] = [
  { id: DHL, code: "dhl", name: "DHL", tracking_url_template: null, is_active: true },
  { id: UPS, code: "ups", name: "UPS", tracking_url_template: null, is_active: true },
];
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";

const order = (id: string, patch: Partial<SellerOrder> = {}): SellerOrder =>
  ({
    id,
    store_id: "s1",
    status: "pending",
    payment_provider: "cod",
    payment_status: "pending",
    full_name: `Customer ${id.slice(0, 1).toUpperCase()}`,
    city: "Kabul",
    country: "AF",
    total: 25,
    total_amount: 25,
    subtotal: 25,
    currency: "USD",
    created_at: "2026-11-10T10:00:00Z",
    order_items: [
      { quantity: 2 } as SellerOrder["order_items"][number],
      { quantity: 1 } as SellerOrder["order_items"][number],
    ],
    ...patch,
  }) as SellerOrder;

beforeEach(() => {
  m().reset();
  spies.getOrders.mockReset();
  spies.forOrders.mockReset().mockResolvedValue([]);
  spies.activeCarriers.mockReset().mockResolvedValue(carriers);
});

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------
describe("shippableOrders", () => {
  it("status that can ship, paid if online, no shipment yet", () => {
    const list = [
      order("1", { status: "pending" }),
      order("2", { status: "processing", payment_provider: "stripe", payment_status: "paid" }),
      order("3", { status: "processing", payment_provider: "stripe", payment_status: "pending" }),
      order("4", { status: "cancelled" }),
      order("5", { status: "delivered" }),
      order("6", { status: "pending" }), // already has a shipment
      order("7", { status: "shipped" }), // marked shipped but no tracking yet
      order("8", { payment_provider: null, payment_status: null }), // legacy: pay on delivery
    ];
    expect(shippableOrders(list, new Set(["6"])).map((o) => o.id)).toEqual(["1", "2", "7", "8"]);
  });
});

// ---------------------------------------------------------------------------
// Row checks
// ---------------------------------------------------------------------------
describe("row validation", () => {
  it.each([
    [" AB 123 45 ", "AB12345"],
    ["1Z-999-AA1", "1Z-999-AA1"],
    ["a".repeat(40), "a".repeat(40)],
  ])("%j is saved as %j", (input, out) => {
    expect(bulkTrackingNumberSchema.parse(input)).toBe(out);
  });

  it.each([
    ["AB12", /at least 5/],
    ["AB 1 2", /at least 5/], // spaces don't count
    ["a".repeat(41), /at most 40/],
    ["AB_12345", /letters, numbers, dashes and spaces/],
    ["AB.12345", /letters, numbers, dashes and spaces/],
    ["-ABCDE", /Start and end/],
    ["ABCDE-", /Start and end/],
  ])("%j is refused (%s)", (input, msg) => {
    const r = bulkTrackingNumberSchema.safeParse(input);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(msg);
  });

  const ids = new Set([DHL, UPS]);
  const row = (orderId: string, carrierId: string, tracking: string): DraftRow => ({
    orderId,
    carrierId,
    tracking,
  });

  it("empty rows are skipped; filled rows need a carrier", () => {
    const r = validateRows([row(A, "", ""), row(B, "", "ZX12345"), row(C, DHL, "ZX 999 88")], ids);
    expect(r.filled).toBe(2);
    expect(r.errors).toEqual({ [B]: { carrier: "Choose a carrier." } });
    expect(r.ready).toEqual([{ orderId: C, carrierId: DHL, trackingNumber: "ZX99988" }]);
  });

  it("duplicates inside the form are flagged on every row (ignoring case and spaces)", () => {
    const r = validateRows(
      [row(A, DHL, "ab 12345"), row(B, UPS, "AB12345"), row(C, DHL, "OTHER1")],
      ids,
    );
    expect(r.errors[A]?.tracking).toMatch(/more than once/);
    expect(r.errors[B]?.tracking).toMatch(/more than once/);
    expect(r.ready.map((x) => x.orderId)).toEqual([C]);
  });

  it("a carrier that is no longer active is refused", () => {
    const r = validateRows([row(A, "ffffffff-ffff-4fff-8fff-ffffffffffff", "ABCDE1")], ids);
    expect(r.errors[A]?.carrier).toMatch(/isn't available/);
  });

  it("'same carrier for all' fills only empty carrier cells", () => {
    expect(
      fillEmptyCarriers([row(A, "", ""), row(B, UPS, "")], DHL).map((r) => r.carrierId),
    ).toEqual([DHL, UPS]);
  });
});

describe("paste one per line", () => {
  const rows: DraftRow[] = [
    { orderId: A, carrierId: "", tracking: "" },
    { orderId: B, carrierId: "", tracking: "KEEP-ME-1" },
    { orderId: C, carrierId: "", tracking: "" },
  ];
  it("previews which empty rows get which number; leftovers are listed, nothing applied yet", () => {
    const pasted = parsePastedNumbers(" N1-AAAAA \r\n\n N2-BBBBB\nN3-CCCCC\n");
    expect(pasted).toEqual(["N1-AAAAA", "N2-BBBBB", "N3-CCCCC"]);
    const plan = planPasteFill(rows, pasted);
    expect(plan.assignments).toEqual([
      { orderId: A, tracking: "N1-AAAAA" },
      { orderId: C, tracking: "N2-BBBBB" },
    ]);
    expect(plan.leftover).toEqual(["N3-CCCCC"]);
    expect(rows[0]!.tracking).toBe(""); // planning never changes rows
  });
  it("apply fills only the planned empty cells, never overwrites a typed number", () => {
    const plan = planPasteFill(rows, ["N1-AAAAA", "N2-BBBBB"]);
    expect(applyPasteFill(rows, plan).map((r) => r.tracking)).toEqual([
      "N1-AAAAA",
      "KEEP-ME-1",
      "N2-BBBBB",
    ]);
  });
});

describe("saveTrackingRows", () => {
  it("one by one through the shipment insert; a failure keeps the real error and never blocks the rest", async () => {
    m().state.queue.push(
      { data: { id: "s1" } },
      {
        error: { code: "P0001", message: "Online orders must be paid before they can be shipped." },
      },
      { data: { id: "s3" } },
    );
    const progress: number[] = [];
    const results = await saveTrackingRows(
      [
        { orderId: A, carrierId: DHL, trackingNumber: "AAA11111" },
        { orderId: B, carrierId: DHL, trackingNumber: "BBB22222" },
        { orderId: C, carrierId: UPS, trackingNumber: "CCC33333" },
      ],
      (done) => progress.push(done),
    );
    expect(results).toEqual([
      { orderId: A, ok: true },
      { orderId: B, ok: false, error: "Online orders must be paid before they can be shipped." },
      { orderId: C, ok: true },
    ]);
    expect(progress).toEqual([1, 2, 3]);
    const inserts = m()
      .state.queries.filter((q) => q.table === "shipments")
      .map((q) => q.calls.find(([k]) => k === "insert")?.[1] as Record<string, unknown>);
    expect(inserts).toHaveLength(3);
    expect(inserts[0]).toEqual({
      order_id: A,
      carrier_id: DHL,
      carrier_name: null,
      tracking_number: "AAA11111",
      tracking_url: null,
      status: "in_transit",
    });
  });
});

// ---------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------
async function openDialog(orders: SellerOrder[]) {
  spies.getOrders.mockResolvedValue(orders);
  renderWithRouter(<BulkTracking stores={[{ id: "s1" } as StoreRow]} />);
  fireEvent.click(await screen.findByRole("button", { name: "Add tracking numbers" }));
  return screen.findByRole("dialog", { name: "Add tracking numbers" });
}
const tracking = (short: string) =>
  screen.getByRole("textbox", { name: `Tracking number for order #${short}` });
const carrier = (short: string) =>
  screen.getByRole("combobox", { name: `Carrier for order #${short}` });
const footerClose = () =>
  within(document.querySelector<HTMLElement>(".bulk-footer")!).getByRole("button", {
    name: "Close",
  });
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });

describe("Add tracking numbers dialog", () => {
  it("lists only orders that can still ship, with the order's details", async () => {
    spies.forOrders.mockResolvedValue([{ order_id: C }]);
    const dialog = await openDialog([order(A), order(B, { status: "cancelled" }), order(C)]);
    const table = await within(dialog).findByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("#aaaaaaaa");
    expect(rows[0]).toHaveTextContent("Customer A");
    expect(rows[0]).toHaveTextContent("Kabul, AF");
    expect(rows[0]).toHaveTextContent("3"); // items
    expect(rows[0]).toHaveTextContent("$25.00");
    expect(spies.forOrders).toHaveBeenCalledWith([A, B, C]);
  });

  it("empty state", async () => {
    const dialog = await openDialog([order(A, { status: "delivered" })]);
    expect(await within(dialog).findByText("No orders are waiting to ship.")).toBeTruthy();
  });

  it("loading error shows the real database error", async () => {
    spies.activeCarriers.mockRejectedValue({
      code: "PGRST205",
      message: "Could not find the table 'public.carriers'",
    });
    const dialog = await openDialog([order(A)]);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Shipment tracking isn't set up in the database yet: Could not find the table 'public.carriers'",
    );
  });

  it("inputs are labelled per order, uppercase-friendly; Enter moves to the next row", async () => {
    await openDialog([order(A), order(B)]);
    const first = await screen.findByRole("textbox", {
      name: "Tracking number for order #aaaaaaaa",
    });
    expect(first).toHaveAttribute("inputmode", "text");
    expect(first).toHaveAttribute("autocapitalize", "characters");
    first.focus();
    fireEvent.keyDown(first, { key: "Enter" });
    expect(document.activeElement).toBe(tracking("bbbbbbbb"));
  });

  it("search by order number or customer; same carrier fills only empty cells", async () => {
    await openDialog([order(A), order(B, { full_name: "Sara Ahmadi" })]);
    await screen.findByRole("table");
    fireEvent.change(carrier("bbbbbbbb"), { target: { value: UPS } });
    fireEvent.change(screen.getByRole("combobox", { name: "Same carrier for all rows" }), {
      target: { value: DHL },
    });
    expect(carrier("aaaaaaaa")).toHaveValue(DHL);
    expect(carrier("bbbbbbbb")).toHaveValue(UPS);
    type(screen.getByRole("searchbox", { name: "Search" }), "sara");
    expect(screen.queryByRole("textbox", { name: /#aaaaaaaa/ })).toBeNull();
    type(screen.getByRole("searchbox", { name: "Search" }), "#aaaa");
    expect(tracking("aaaaaaaa")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /#bbbbbbbb/ })).toBeNull();
  });

  it("the save button counts filled rows; invalid cells get a message and nothing is sent", async () => {
    await openDialog([order(A), order(B), order(C)]);
    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: "Save tracking numbers" })).toBeDisabled();
    type(tracking("aaaaaaaa"), "AB12");
    type(tracking("bbbbbbbb"), "SAME-12345");
    fireEvent.change(carrier("bbbbbbbb"), { target: { value: DHL } });
    type(tracking("cccccccc"), "same-12345");
    fireEvent.click(screen.getByRole("button", { name: "Save 3 tracking numbers" }));
    expect(await screen.findByText(/Use at least 5 characters/)).toBeTruthy();
    expect(tracking("aaaaaaaa")).toHaveAttribute("aria-invalid", "true");
    expect(tracking("aaaaaaaa")).toHaveAccessibleDescription(/Use at least 5 characters/);
    expect(screen.getAllByText(/used more than once/)).toHaveLength(2);
    expect(screen.getAllByText("Choose a carrier.")).toHaveLength(2); // A and C
    expect(document.activeElement).toBe(tracking("aaaaaaaa"));
    expect(m().state.queries.filter((q) => q.table === "shipments")).toHaveLength(0);
  });

  it("partial failure: saved rows disappear, the failed row stays with the real error; retry works", async () => {
    await openDialog([order(A), order(B)]);
    await screen.findByRole("table");
    fireEvent.change(screen.getByRole("combobox", { name: "Same carrier for all rows" }), {
      target: { value: DHL },
    });
    type(tracking("aaaaaaaa"), "GOOD-11111");
    type(tracking("bbbbbbbb"), "FAIL-22222");
    m().state.queue.push(
      { data: { id: "s1" } },
      {
        error: { code: "P0001", message: "Online orders must be paid before they can be shipped." },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save 2 tracking numbers" }));
    expect(await screen.findByText(/Saved 1 tracking number · 1 failed/)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /#aaaaaaaa/ })).toBeNull();
    expect(tracking("bbbbbbbb")).toHaveValue("FAIL-22222");
    expect(
      screen.getByText("Not saved: Online orders must be paid before they can be shipped."),
    ).toBeTruthy();

    // Retry the failed row after fixing it.
    type(tracking("bbbbbbbb"), "FAIL-33333");
    expect(screen.queryByText(/Not saved:/)).toBeNull();
    m().state.queue.push({ data: { id: "s2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save 1 tracking number" }));
    expect(await screen.findByText(/Saved 1 tracking number\./)).toBeTruthy();
    expect(await screen.findByText("No orders are waiting to ship.")).toBeTruthy();
  });

  it("paste: preview first, then apply into the empty rows in the order shown", async () => {
    await openDialog([order(A), order(B), order(C)]);
    await screen.findByRole("table");
    type(tracking("bbbbbbbb"), "TYPED-1234");
    fireEvent.click(screen.getByText(/Paste tracking numbers/));
    type(
      screen.getByRole("textbox", { name: "Tracking numbers, one per line" }),
      "P1-AAAAA\nP2-BBBBB\nP3-CCCCC",
    );
    fireEvent.click(screen.getByRole("button", { name: "Fill the first 2 empty rows" }));
    const preview = screen.getByRole("region", { name: "Preview" });
    expect(preview).toHaveTextContent("#aaaaaaaa → P1-AAAAA");
    expect(preview).toHaveTextContent("#cccccccc → P2-BBBBB");
    expect(preview).toHaveTextContent("1 number won't be used");
    expect(tracking("aaaaaaaa")).toHaveValue(""); // not applied silently
    fireEvent.click(within(preview).getByRole("button", { name: "Apply" }));
    expect(tracking("aaaaaaaa")).toHaveValue("P1-AAAAA");
    expect(tracking("bbbbbbbb")).toHaveValue("TYPED-1234");
    expect(tracking("cccccccc")).toHaveValue("P2-BBBBB");
  });

  it("closing with typed numbers asks first", async () => {
    await openDialog([order(A)]);
    await screen.findByRole("table");
    type(tracking("aaaaaaaa"), "ABCDE12");
    fireEvent.click(footerClose());
    const ask = await screen.findByRole("alertdialog");
    expect(ask).toHaveTextContent("You have 1 unsaved tracking number. Close anyway?");
    fireEvent.click(within(ask).getByRole("button", { name: "Keep editing" }));
    expect(tracking("aaaaaaaa")).toHaveValue("ABCDE12");
    fireEvent.click(footerClose());
    fireEvent.click(await screen.findByRole("button", { name: "Close without saving" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

// ---------------------------------------------------------------------------
// The CSV import is gone
// ---------------------------------------------------------------------------
describe("no CSV import left", () => {
  it("no source, style or text mentions the CSV import", () => {
    const files = import.meta.glob("/src/**/*.{ts,tsx,css,json}", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const hits = Object.entries(files)
      .filter(([path]) => !path.endsWith("/bulk-tracking.test.tsx"))
      .filter(([, text]) =>
        /\bcsv\b|tracking-import|TrackingImport|drop-zone|Download template|Import tracking/i.test(
          text,
        ),
      )
      .map(([path]) => path);
    expect(hits).toEqual([]);
    expect(Object.keys(files).some((p) => /tracking-import|csv-file/.test(p))).toBe(false);
  });
});
