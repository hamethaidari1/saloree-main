import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "./supabase-mock";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

import { searchCustomers, sortCustomers } from "@/services/customers";
import { filterOrders } from "@/services/orders";
import { sellerDashboardService, type SellerCustomer } from "@/services/seller-dashboard";
import { fillDayGaps } from "@/components/seller/stats";
import { SELLER_NAV } from "@/components/seller/seller-shell";

const m = () => mock.current!;
beforeEach(() => m().reset());

const analyticsReply = {
  gross_sales: "120.50",
  orders: 4,
  net_earnings: "108.45",
  commission_paid: "12.05",
  discounts_given: "3.00",
  average_order_value: "30.125",
  cancelled_orders: 1,
  orders_by_status: { pending: 2, delivered: 1, cancelled: 1 },
  by_day: [
    { day: "2026-11-10", orders: 1, sales: "20" },
    { day: "2026-11-12", orders: 3, sales: 100.5 },
  ],
  top_products: [{ product_id: "p1", title: "Fan", quantity: 3, revenue: "45" }],
};

describe("seller_analytics", () => {
  // Contract change: seller_analytics now takes p_store_id (one store, or null = all mine).
  it("calls the RPC with p_days and p_store_id, and coerces numeric strings", async () => {
    m().state.queue.push({ data: analyticsReply });
    const a = await sellerDashboardService.analytics(30, "store-1");
    expect(m().state.rpcs).toEqual([
      { fn: "seller_analytics", args: { p_days: 30, p_store_id: "store-1" } },
    ]);
    expect(a).toMatchObject({
      gross_sales: 120.5,
      net_earnings: 108.45,
      commission_paid: 12.05,
      orders_by_status: [
        { status: "pending", count: 2 },
        { status: "delivered", count: 1 },
        { status: "cancelled", count: 1 },
      ],
      top_products: [{ title: "Fan", revenue: 45 }],
    });
    expect(a.by_day[0]).toEqual({ day: "2026-11-10", orders: 1, sales: 20 });
  });

  it("accepts orders_by_status as an array and a single-row array wrapper", async () => {
    m().state.queue.push({
      data: [{ ...analyticsReply, orders_by_status: [{ status: "pending", count: "2" }] }],
    });
    const a = await sellerDashboardService.analytics(7, null);
    expect(a.orders_by_status).toEqual([{ status: "pending", count: 2 }]);
  });

  it("treats null lists as empty (no data yet)", async () => {
    m().state.queue.push({
      data: { ...analyticsReply, by_day: null, top_products: null, orders_by_status: null },
    });
    const a = await sellerDashboardService.analytics(7, null);
    expect([a.by_day, a.top_products, a.orders_by_status]).toEqual([[], [], []]);
  });

  it("names the missing fields instead of showing wrong numbers", async () => {
    m().state.queue.push({ data: { total_sales: 1, by_day: [] } });
    await expect(sellerDashboardService.analytics(7, null)).rejects.toThrow(
      /seller_analytics returned an unexpected shape \(check: .*gross_sales/,
    );
  });

  it("surfaces database errors as-is (e.g. function missing)", async () => {
    m().state.queue.push({ error: { code: "PGRST202", message: "Could not find the function" } });
    await expect(sellerDashboardService.analytics(7, null)).rejects.toMatchObject({
      code: "PGRST202",
    });
  });
});

const customerRow = (patch: Partial<SellerCustomer> = {}): SellerCustomer => ({
  customer_id: "c1",
  full_name: "Sara Ahmadi",
  email: "sara@example.com",
  phone: "+93 70 123 4567",
  country: "Afghanistan",
  city: "Kabul",
  orders_count: 2,
  total_spent: 50,
  last_order_at: "2026-11-10T10:00:00Z",
  ...patch,
});

describe("seller_customers", () => {
  it("calls the RPC and parses rows", async () => {
    m().state.queue.push({ data: [{ ...customerRow(), total_spent: "50.00", orders_count: "2" }] });
    const rows = await sellerDashboardService.customers("store-1");
    // Contract change: p_store_id limits to one store (null = all mine).
    expect(m().state.rpcs[0]).toEqual({ fn: "seller_customers", args: { p_store_id: "store-1" } });
    expect(rows).toEqual([customerRow()]);
  });
  it("rejects an unexpected shape", async () => {
    m().state.queue.push({ data: [{ id: "c1" }] });
    await expect(sellerDashboardService.customers(null)).rejects.toThrow(/seller_customers/);
  });
  it("loads one customer's orders limited to my stores", async () => {
    m().state.queue.push({ data: [{ id: "o1" }] });
    await sellerDashboardService.customerOrders("c1", ["s1", "s2"]);
    const calls = m().callsOn("orders");
    expect(calls).toContainEqual(["eq", "customer_id", "c1"]);
    expect(calls).toContainEqual(["in", "store_id", ["s1", "s2"]]);
  });
  it("search matches name, email and phone digits", () => {
    const rows = [
      customerRow(),
      customerRow({ customer_id: "c2", full_name: "Amir", email: "a@x.io", phone: null }),
    ];
    expect(searchCustomers(rows, "sara").map((c) => c.customer_id)).toEqual(["c1"]);
    expect(searchCustomers(rows, "A@X").map((c) => c.customer_id)).toEqual(["c2"]);
    expect(searchCustomers(rows, "70 123").map((c) => c.customer_id)).toEqual(["c1"]);
    expect(searchCustomers(rows, "")).toHaveLength(2);
  });
  it("sorts both ways and keeps empty values last", () => {
    const rows = [
      customerRow({ customer_id: "a", total_spent: 10, last_order_at: null }),
      customerRow({ customer_id: "b", total_spent: 30 }),
      customerRow({ customer_id: "c", total_spent: 20, last_order_at: "2026-11-11T00:00:00Z" }),
    ];
    const ids = (r: SellerCustomer[]) => r.map((c) => c.customer_id);
    expect(ids(sortCustomers(rows, { key: "total_spent", dir: "desc" }))).toEqual(["b", "c", "a"]);
    expect(ids(sortCustomers(rows, { key: "total_spent", dir: "asc" }))).toEqual(["a", "c", "b"]);
    expect(ids(sortCustomers(rows, { key: "last_order_at", dir: "desc" }))).toEqual([
      "c",
      "b",
      "a",
    ]);
    expect(ids(sortCustomers(rows, { key: "last_order_at", dir: "asc" }))).toEqual(["b", "c", "a"]);
  });
});

describe("home counts", () => {
  it("counts pending orders in my stores", async () => {
    m().state.queue.push({ count: 3 });
    expect(await sellerDashboardService.pendingOrdersCount(["s1"])).toBe(3);
    const calls = m().callsOn("orders");
    expect(calls).toContainEqual(["eq", "status", "pending"]);
    expect(calls).toContainEqual(["in", "store_id", ["s1"]]);
    expect(calls[0]).toEqual(["select", "id", { count: "exact", head: true }]);
  });
  it("lists active products with stock <= 5", async () => {
    m().state.queue.push({ data: [{ id: "p1", title: "Fan", stock: 2, featured_image: null }] });
    const rows = await sellerDashboardService.lowStock(["s1"]);
    expect(rows).toHaveLength(1);
    const calls = m().callsOn("products");
    expect(calls).toContainEqual(["eq", "status", "active"]);
    expect(calls).toContainEqual(["lte", "stock", 5]);
  });
  it("does not query without stores", async () => {
    expect(await sellerDashboardService.pendingOrdersCount([])).toBe(0);
    expect(await sellerDashboardService.lowStock([])).toEqual([]);
    expect(await sellerDashboardService.customerOrders("c1", [])).toEqual([]);
    expect(m().state.queries).toEqual([]);
  });
});

describe("inventory", () => {
  it("updates stock for one product", async () => {
    m().state.queue.push({ data: [{ id: "p1", stock: 7 }] });
    expect(await sellerDashboardService.updateStock("p1", "7")).toBe(7);
    const calls = m().callsOn("products");
    expect(calls).toContainEqual(["update", { stock: 7 }]);
    expect(calls).toContainEqual(["eq", "id", "p1"]);
  });
  it.each(["-1", "1.5", "abc", ""])("rejects %j without calling the database", async (v) => {
    await expect(sellerDashboardService.updateStock("p1", v)).rejects.toThrow();
    expect(m().state.queries).toEqual([]);
  });
  it("fails when RLS blocks the update (not my product)", async () => {
    await expect(sellerDashboardService.updateStock("p1", 3)).rejects.toMatchObject({
      code: "42501",
    });
  });
});

describe("orders filter", () => {
  const orders = [
    { status: "pending", full_name: "Sara Ahmadi", phone: "+93 70 123 4567" },
    { status: "shipped", full_name: "Amir K", phone: null },
  ];
  it("filters by status and name/phone", () => {
    expect(filterOrders(orders, { status: "pending", query: "" })).toHaveLength(1);
    expect(filterOrders(orders, { status: "", query: "amir" })[0]?.full_name).toBe("Amir K");
    expect(filterOrders(orders, { status: "", query: "123 45" })[0]?.full_name).toBe("Sara Ahmadi");
    expect(filterOrders(orders, { status: "delivered", query: "" })).toEqual([]);
  });
});

describe("daily chart data", () => {
  it("fills gaps between returned days with zero, never beyond them", () => {
    expect(
      fillDayGaps([
        { day: "2026-11-12", orders: 3, sales: 100 },
        { day: "2026-11-10", orders: 1, sales: 20 },
      ]),
    ).toEqual([
      { day: "2026-11-10", orders: 1, sales: 20 },
      { day: "2026-11-11", orders: 0, sales: 0 },
      { day: "2026-11-12", orders: 3, sales: 100 },
    ]);
    expect(fillDayGaps([])).toEqual([]);
  });
});

describe("seller menu", () => {
  it("has exactly the agreed items, in order", () => {
    expect(SELLER_NAV.map((i) => i.label)).toEqual([
      "Home",
      "Orders",
      "Products",
      "Customers",
      "Discounts",
      "Analytics",
      "Payouts",
      "Support",
      "Content",
      "Online Store",
    ]);
    const products = SELLER_NAV.find((i) => i.label === "Products");
    expect(products && "children" in products && products.children.map((c) => c.to)).toEqual([
      "/seller/products",
      "/seller/inventory",
    ]);
  });
  it("every item and sub-item has an icon (needed when the sidebar is collapsed)", () => {
    for (const item of SELLER_NAV) {
      expect(item.icon, item.label).toBeTruthy();
      if ("children" in item)
        for (const child of item.children) expect(child.icon, child.label).toBeTruthy();
    }
  });
});
