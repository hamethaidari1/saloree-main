import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  session: { user: { id: "user-1" } } as { user: { id: string } } | null,
  rpcCalls: [] as { fn: string; args: unknown }[],
  rpcResult: { data: null as unknown, error: null as unknown },
  tableWrites: [] as string[],
  orderRows: [] as unknown[],
}));

vi.mock("@/lib/supabase", () => {
  const forbidWrite = (table: string, op: string) => () => {
    db.tableWrites.push(`${op} ${table}`);
    throw new Error(`Direct ${op} on ${table} is not allowed`);
  };
  return {
    supabase: {
      auth: {
        getSession: async () => ({ data: { session: db.session } }),
        getUser: async () => ({ data: { user: db.session?.user ?? null } }),
      },
      rpc: async (fn: string, args: unknown) => {
        db.rpcCalls.push({ fn, args });
        return db.rpcResult;
      },
      from: (table: string) => {
        const b: Record<string, unknown> = {
          select: () => b,
          eq: () => b,
          order: () => b,
          insert: forbidWrite(table, "insert"),
          update: forbidWrite(table, "update"),
          upsert: forbidWrite(table, "upsert"),
          then: (ok: (v: unknown) => unknown) =>
            Promise.resolve({ data: db.orderRows, error: null }).then(ok),
        };
        return b;
      },
    },
  };
});

import {
  checkoutCustomerSchema,
  checkoutService,
  discountCodeSchema,
  isInvalidDiscountError,
  PAYMENT_METHODS,
  toOrderItems,
} from "@/services/checkout";
import {
  canCancel,
  formatAddress,
  lineAmounts,
  orderTotal,
  ordersService,
} from "@/services/orders";
import { money } from "@/services/catalog";

const P1 = "074fe87b-ca8f-41d9-85f8-35f63e138062";
const P2 = "ae31c344-3d17-4650-964a-18d269a820a8";
const customer = {
  full_name: "Sara Ahmadi",
  phone: "+93 70 123 4567",
  email: "sara@example.com",
  country: "Afghanistan",
  city: "Kabul",
  address: "Street 4, House 12",
  notes: "",
};
const serverResult = {
  checkout_group_id: "g-1",
  total: "37.97", // numeric may arrive as a string
  currency: "USD",
  orders: [
    { id: "o-1", store_id: "s-1", total: 23.98 },
    { id: "o-2", store_id: "s-2", total: "13.99" },
  ],
};

beforeEach(() => {
  db.session = { user: { id: "user-1" } };
  db.rpcCalls.length = 0;
  db.tableWrites.length = 0;
  db.rpcResult = { data: serverResult, error: null };
  db.orderRows = [];
});

describe("placeOrder", () => {
  it("calls place_order with items, customer and 'cod' — and nothing else", async () => {
    const result = await checkoutService.placeOrder(
      [
        { productId: P1, quantity: 2 },
        { productId: P2, quantity: 1 },
      ],
      customer,
      "cod",
    );
    expect(db.rpcCalls).toEqual([
      {
        fn: "place_order",
        args: {
          p_items: [
            { product_id: P1, quantity: 2 },
            { product_id: P2, quantity: 1 },
          ],
          p_customer: { ...customer, notes: null },
          p_payment_provider: "cod",
          p_discount_code: null,
        },
      },
    ]);
    expect(db.tableWrites).toEqual([]); // never inserts orders directly
    // Older replies without discount fields read as "no discount".
    expect(result).toEqual({
      ...serverResult,
      total: 37.97,
      discount_total: 0,
      orders: [
        { id: "o-1", store_id: "s-1", total: 23.98, discount: 0 },
        { id: "o-2", store_id: "s-2", total: 13.99, discount: 0 },
      ],
    });
  });

  it("sends the discount code (uppercased) as the 4th parameter and returns the server's discount", async () => {
    db.rpcResult = {
      data: {
        checkout_group_id: "g-2",
        total: "21.58",
        discount_total: "2.40",
        currency: "USD",
        payment_provider: "cod",
        orders: [{ id: "o-9", store_id: "s-1", total: "21.58", discount: "2.40" }],
      },
      error: null,
    };
    const result = await checkoutService.placeOrder(
      [{ productId: P1, quantity: 2 }],
      customer,
      "cod",
      "  summer10 ",
    );
    expect((db.rpcCalls[0]?.args as { p_discount_code: unknown }).p_discount_code).toBe("SUMMER10");
    expect(result).toMatchObject({
      total: 21.58,
      discount_total: 2.4,
      payment_provider: "cod",
      orders: [{ id: "o-9", discount: 2.4 }],
    });
  });

  it("rejects a malformed code before calling the server", async () => {
    await expect(
      checkoutService.placeOrder([{ productId: P1, quantity: 1 }], customer, "cod", "no spaces!"),
    ).rejects.toThrow(/discount code/);
    expect(db.rpcCalls).toEqual([]);
  });

  it("recognises the server's invalid-discount error (cart stays as is)", async () => {
    db.rpcResult = {
      data: null,
      error: {
        code: "P0001",
        message: "This discount code is not valid for the items in your cart",
      },
    };
    const err = await checkoutService
      .placeOrder([{ productId: P1, quantity: 1 }], customer, "cod", "WRONG1")
      .catch((e: unknown) => e);
    expect(isInvalidDiscountError(err)).toBe(true);
    expect(isInvalidDiscountError(new Error("Not enough stock"))).toBe(false);
    expect(db.tableWrites).toEqual([]);
  });

  it("never sends prices — only product ids and quantities", async () => {
    await checkoutService.placeOrder([{ productId: P1, quantity: 1 }], customer);
    const args = db.rpcCalls[0]?.args as { p_items: object[] };
    expect(Object.keys(args.p_items[0] ?? {}).sort()).toEqual(["product_id", "quantity"]);
  });

  it("requires sign-in", async () => {
    db.session = null;
    await expect(
      checkoutService.placeOrder([{ productId: P1, quantity: 1 }], customer),
    ).rejects.toMatchObject({ code: "42501" });
    expect(db.rpcCalls).toEqual([]);
  });

  it("rejects an empty bag, invalid details and disabled payment methods before calling", async () => {
    await expect(checkoutService.placeOrder([], customer)).rejects.toThrow(/empty/);
    await expect(
      checkoutService.placeOrder([{ productId: P1, quantity: 1 }], { ...customer, phone: "x" }),
    ).rejects.toThrow();
    await expect(
      checkoutService.placeOrder(
        [{ productId: P1, quantity: 1 }],
        customer,
        "stripe" as unknown as "cod",
      ),
    ).rejects.toThrow(/isn't available/);
    expect(db.rpcCalls).toEqual([]);
  });

  it("surfaces database errors (e.g. out of stock)", async () => {
    db.rpcResult = {
      data: null,
      error: { code: "P0001", message: "Not enough stock for Desk Fan" },
    };
    await expect(
      checkoutService.placeOrder([{ productId: P1, quantity: 9 }], customer),
    ).rejects.toMatchObject({ message: "Not enough stock for Desk Fan" });
  });

  it("does not show a made-up total when the server reply is malformed", async () => {
    db.rpcResult = { data: { ok: true }, error: null };
    await expect(
      checkoutService.placeOrder([{ productId: P1, quantity: 1 }], customer),
    ).rejects.toThrow(/Check My orders/);
  });
});

describe("cart → order items", () => {
  it("merges duplicates and drops invalid quantities", () =>
    expect(
      toOrderItems([
        { productId: P1, quantity: 1 },
        { productId: P1, quantity: 2 },
        { productId: P2, quantity: 0 },
        { productId: P2, quantity: 1.5 },
      ]),
    ).toEqual([{ product_id: P1, quantity: 3 }]));
});

describe("checkout form validation", () => {
  it("requires delivery details and allows empty notes", () => {
    expect(checkoutCustomerSchema.parse(customer).notes).toBeNull();
    const r = checkoutCustomerSchema.safeParse({
      ...customer,
      full_name: " ",
      email: "nope",
      address: "",
    });
    expect(Object.keys(r.error?.flatten().fieldErrors ?? {}).sort()).toEqual([
      "address",
      "email",
      "full_name",
    ]);
  });
});

describe("payment methods", () => {
  it("only pay on delivery is enabled; Stripe and HesabPay are coming soon", () => {
    expect(PAYMENT_METHODS.filter((m) => m.enabled).map((m) => m.id)).toEqual(["cod"]);
    for (const id of ["stripe", "hesabpay"])
      expect(PAYMENT_METHODS.find((m) => m.id === id)).toMatchObject({
        enabled: false,
        description: "Coming soon",
      });
  });
});

describe("confirmation after reload", () => {
  it("rebuilds the server totals from saved orders", async () => {
    db.orderRows = [
      { id: "o-1", store_id: "s-1", total: "0.10", total_amount: null, currency: "EUR" },
      { id: "o-2", store_id: "s-2", total: "0.20", total_amount: null, currency: "EUR" },
    ];
    await expect(checkoutService.getCheckoutGroup("g-1")).resolves.toMatchObject({
      total: 0.3, // not 0.30000000000000004
      currency: "EUR",
      orders: [{ total: 0.1 }, { total: 0.2 }],
    });
  });
  it("includes the saved discount amounts", async () => {
    db.orderRows = [
      {
        id: "o-1",
        store_id: "s-1",
        total: "9.00",
        total_amount: null,
        currency: "USD",
        discount_amount: "1.10",
        payment_provider: "cod",
      },
      {
        id: "o-2",
        store_id: "s-2",
        total: "5.00",
        total_amount: null,
        currency: "USD",
        discount_amount: "0.20",
        payment_provider: "cod",
      },
    ];
    await expect(checkoutService.getCheckoutGroup("g-1")).resolves.toMatchObject({
      total: 14,
      discount_total: 1.3,
      payment_provider: "cod",
      orders: [{ discount: 1.1 }, { discount: 0.2 }],
    });
  });
  it("returns null for an unknown group", async () =>
    expect(await checkoutService.getCheckoutGroup("nope")).toBeNull());
});

describe("discount code field", () => {
  it("is optional, uppercased and format-checked", () => {
    expect(discountCodeSchema.parse("")).toBeNull();
    expect(discountCodeSchema.parse("   ")).toBeNull();
    expect(discountCodeSchema.parse(" save-5 ")).toBe("SAVE-5");
    expect(discountCodeSchema.safeParse("AB").success).toBe(false);
    expect(discountCodeSchema.safeParse("HAS SPACE").success).toBe(false);
  });
});

describe("my orders", () => {
  it("cancels through cancel_my_order only", async () => {
    db.rpcResult = { data: null, error: null };
    await ordersService.cancelMyOrder("o-1");
    expect(db.rpcCalls).toEqual([{ fn: "cancel_my_order", args: { p_order_id: "o-1" } }]);
    expect(db.tableWrites).toEqual([]);
  });
  it("reports a refused cancellation", async () => {
    db.rpcResult = { data: null, error: { code: "P0001", message: "Order already shipped" } };
    await expect(ordersService.cancelMyOrder("o-1")).rejects.toMatchObject({
      message: "Order already shipped",
    });
  });
  it("offers Cancel only for pending orders", () => {
    expect(canCancel({ status: "pending" })).toBe(true);
    for (const status of ["processing", "shipped", "delivered", "cancelled"])
      expect(canCancel({ status })).toBe(false);
  });
});

describe("order display helpers", () => {
  it("prefers the server total", () =>
    expect(orderTotal({ total: 20, total_amount: 0, subtotal: 18 })).toBe(20));
  it("computes line amounts", () => {
    expect(lineAmounts({ quantity: 3, unit_price: 1.1, price: null, total: null })).toEqual({
      unit: 1.1,
      line: 3.3,
    });
    expect(lineAmounts({ quantity: 2, unit_price: null, price: 5, total: 9 })).toEqual({
      unit: 5,
      line: 9,
    });
  });
  it("formats the address from columns or legacy JSON", () => {
    expect(
      formatAddress({
        address: "Street 4",
        city: "Kabul",
        country: "Afghanistan",
        shipping_address: null,
      }),
    ).toBe("Street 4, Kabul, Afghanistan");
    expect(
      formatAddress({
        address: null,
        city: null,
        country: null,
        shipping_address: { line1: "A", city: "B" },
      }),
    ).toBe("A, B");
  });
  it("formats the server's currency", () => {
    expect(money(12.5, "EUR")).toBe("€12.50");
    expect(money(12.5, null)).toBe("$12.50");
    expect(money(12.5, "ZZZZ")).toBe("12.50 ZZZZ");
  });
});
