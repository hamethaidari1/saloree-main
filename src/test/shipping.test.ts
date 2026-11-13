import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "./supabase-mock";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

import {
  carrierError,
  carrierInputSchema,
  carriersService,
  shipmentInputSchema,
  shippingError,
  shippingService,
} from "@/services/shipping";
import { ordersService } from "@/services/orders";

const m = () => mock.current!;
beforeEach(() => m().reset());

const ORDER = "11111111-1111-4111-8111-111111111111";
const ORDER2 = "22222222-2222-4222-8222-222222222222";
const CARRIER = "33333333-3333-4333-8333-333333333333";
const SHIP = "44444444-4444-4444-8444-444444444444";
const ALLOWED_INSERT = [
  "carrier_id",
  "carrier_name",
  "order_id",
  "status",
  "tracking_number",
  "tracking_url",
];
const ALLOWED_UPDATE = ["carrier_id", "carrier_name", "tracking_number", "tracking_url"];
const payloadOf = (table: string, op: string) =>
  m()
    .callsOn(table)
    .find(([k]) => k === op)?.[1] as Record<string, unknown> | undefined;

describe("shippingService.activeCarriers", () => {
  it("reads active carriers by name", async () => {
    m().state.queue.push({ data: [{ id: CARRIER, code: "dhl", name: "DHL" }] });
    expect(await shippingService.activeCarriers()).toHaveLength(1);
    expect(m().callsOn("carriers")).toContainEqual(["eq", "is_active", true]);
  });
});

describe("shippingService.forOrders", () => {
  it("embeds carrier and events and sorts events newest first", async () => {
    m().state.queue.push({
      data: [
        {
          id: SHIP,
          order_id: ORDER,
          carriers: null,
          shipment_events: [
            { id: "old", occurred_at: "2026-11-10T00:00:00Z" },
            { id: "new", occurred_at: "2026-11-12T00:00:00Z" },
          ],
        },
      ],
    });
    const [s] = await shippingService.forOrders([ORDER]);
    expect(s?.shipment_events.map((e) => e.id)).toEqual(["new", "old"]);
    const calls = m().callsOn("shipments");
    expect(calls).toContainEqual(["select", "*, carriers(*), shipment_events(*)"]);
    expect(calls).toContainEqual(["in", "order_id", [ORDER]]);
  });
  it("does not query without orders", async () => {
    expect(await shippingService.forOrders([])).toEqual([]);
    expect(m().state.queries).toEqual([]);
  });
  it("passes the real error through (e.g. table not created yet)", async () => {
    m().state.queue.push({
      error: { code: "PGRST205", message: "Could not find the table 'public.shipments'" },
    });
    const err = await shippingService.forOrders([ORDER]).catch((e: unknown) => e);
    expect(shippingError(err)).toBe(
      "Shipment tracking isn't set up in the database yet: Could not find the table 'public.shipments'",
    );
  });
});

describe("shippingService.add", () => {
  it("inserts only the allowed columns, defaulting to in_transit", async () => {
    m().state.queue.push({ data: { id: SHIP } });
    await shippingService.add(ORDER, { carrier_id: CARRIER, tracking_number: " 1Z999-AA/10 " });
    const p = payloadOf("shipments", "insert");
    expect(Object.keys(p ?? {}).sort()).toEqual(ALLOWED_INSERT);
    expect(p).toEqual({
      order_id: ORDER,
      carrier_id: CARRIER,
      carrier_name: null,
      tracking_number: "1Z999-AA/10",
      tracking_url: null,
      status: "in_transit",
    });
  });
  it("'Other' carrier sends the typed name and no id", async () => {
    m().state.queue.push({ data: { id: SHIP } });
    await shippingService.add(ORDER, {
      carrier_id: "",
      carrier_name: "Local Courier",
      tracking_number: "LC-0001",
      tracking_url: "https://local.example/t/LC-0001",
      status: "label_created",
    });
    expect(payloadOf("shipments", "insert")).toMatchObject({
      carrier_id: null,
      carrier_name: "Local Courier",
      tracking_url: "https://local.example/t/LC-0001",
      status: "label_created",
    });
  });
  it.each([
    [{ tracking_number: "ABCD" }, /carrier/],
    [{ carrier_id: CARRIER, tracking_number: "ab" }, /at least 4/],
    [{ carrier_id: CARRIER, tracking_number: "x".repeat(65) }, /at most 64/],
    [{ carrier_id: CARRIER, tracking_number: "AB#12" }, /letters, numbers/],
    [{ carrier_id: CARRIER, tracking_number: "ABCD", tracking_url: "http://x.example" }, /https/],
    [
      { carrier_id: CARRIER, tracking_number: "ABCD", tracking_url: "javascript:alert(1)" },
      /https/,
    ],
    [{ carrier_id: CARRIER, tracking_number: "ABCD", status: "lost" }, /./],
  ])("rejects %j before calling the database", async (input, msg) => {
    const r = shipmentInputSchema.safeParse(input);
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message).join(" ")).toMatch(msg);
    await expect(shippingService.add(ORDER, input as never)).rejects.toThrow();
    expect(m().state.queries).toEqual([]);
  });
  it("maps the duplicate error and passes server rule messages through", async () => {
    m().state.queue.push({ error: { code: "23505", message: "duplicate key" } });
    const dup = await shippingService
      .add(ORDER, { carrier_id: CARRIER, tracking_number: "ABCD" })
      .catch((e: unknown) => e);
    expect(shippingError(dup)).toBe("This tracking number is already added to this order");
    for (const message of [
      "Tracking can't be added to a cancelled order",
      "An online order must be paid before it ships",
      "A delivered shipment can't be changed",
    ])
      expect(shippingError({ code: "P0001", message })).toBe(message);
  });
});

describe("shippingService.edit", () => {
  it("updates only carrier, number and link — never status", async () => {
    m().state.queue.push({ data: [{ id: SHIP }] });
    await shippingService.edit(SHIP, { carrier_id: CARRIER, tracking_number: "NEW-1234" });
    const p = payloadOf("shipments", "update");
    expect(Object.keys(p ?? {}).sort()).toEqual(ALLOWED_UPDATE);
    expect(p).not.toHaveProperty("status");
    expect(m().callsOn("shipments")).toContainEqual(["eq", "id", SHIP]);
  });
  it("fails loudly when RLS matched no row", async () => {
    await expect(
      shippingService.edit(SHIP, { carrier_id: CARRIER, tracking_number: "NEW-1234" }),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

describe("shippingService.addUpdate", () => {
  it("changes status only through add_shipment_update", async () => {
    await shippingService.addUpdate(SHIP, {
      status: "out_for_delivery",
      description: " With the driver ",
      location: "",
    });
    expect(m().state.rpcs).toEqual([
      {
        fn: "add_shipment_update",
        args: {
          p_shipment_id: SHIP,
          p_status: "out_for_delivery",
          p_description: "With the driver",
          p_location: null,
        },
      },
    ]);
    expect(m().state.queries).toEqual([]); // no direct table writes
  });
  it("rejects unknown statuses before calling", async () => {
    await expect(shippingService.addUpdate(SHIP, { status: "lost" as never })).rejects.toThrow();
    expect(m().state.rpcs).toEqual([]);
  });
});

describe("carriersService (admin)", () => {
  const input = {
    name: "DHL Express",
    code: "DHL",
    tracking_url_template: "https://dhl.example/track?n={number}",
  };
  it("creates with a lowercased code", async () => {
    await carriersService.create(input);
    expect(payloadOf("carriers", "insert")).toEqual({
      name: "DHL Express",
      code: "dhl",
      tracking_url_template: "https://dhl.example/track?n={number}",
      is_active: true,
    });
  });
  it("updates and toggles; never deletes", async () => {
    m().state.queue.push({ data: [{ id: CARRIER }] }, { data: [{ id: CARRIER }] });
    await carriersService.update(CARRIER, { ...input, is_active: false });
    await carriersService.setActive(CARRIER, true);
    expect(m().callsOn("carriers", 1)).toContainEqual(["update", { is_active: true }]);
    expect(
      m()
        .state.queries.flatMap((q) => q.calls)
        .some(([k]) => k === "delete"),
    ).toBe(false);
    expect(carriersService).not.toHaveProperty("remove");
  });
  it.each([
    [{ code: "Bad Code!" }, /a–z/],
    [{ tracking_url_template: "http://dhl.example/{number}" }, /https/],
    [{ tracking_url_template: "https://dhl.example/track" }, /\{number\}/],
    [{ name: "D" }, /at least 2/],
  ])("validates %j", (patch, msg) => {
    const r = carrierInputSchema.safeParse({ ...input, ...patch });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(msg);
  });
  it("explains a duplicate code", () =>
    expect(carrierError({ code: "23505", message: "dup" })).toMatch(/already exists/));
  it("lists all carriers including disabled", async () => {
    m().state.queue.push({ data: [{ id: CARRIER }] });
    await carriersService.listAll();
    expect(
      m()
        .callsOn("carriers")
        .some(([k, a]) => k === "eq" && a === "is_active"),
    ).toBe(false);
  });
});

describe("ordersService.getStatuses", () => {
  it("returns id → status for the given orders", async () => {
    m().state.queue.push({ data: [{ id: ORDER, status: "shipped" }] });
    expect(await ordersService.getStatuses([ORDER])).toEqual({ [ORDER]: "shipped" });
    expect(m().callsOn("orders")).toContainEqual(["in", "id", [ORDER]]);
  });
  it("does not query without ids", async () => {
    expect(await ordersService.getStatuses([])).toEqual({});
    expect(m().state.queries).toEqual([]);
  });
});
