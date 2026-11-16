import { z } from "zod";
import type { OrderItemRow, OrderRow, ProductRow } from "@/data/db";
import { supabase } from "@/lib/supabase";
import { expectRows } from "./errors";

// Numbers from Postgres `numeric` can arrive as strings.
const num = z.coerce.number().finite();
const count = z.coerce.number().int().nonnegative();

/** `orders_by_status` may come as { pending: 3 } or [{ status, count }]. */
const ordersByStatus = z
  .union([z.record(z.string(), count), z.array(z.object({ status: z.string(), count })), z.null()])
  .transform((v) =>
    v == null
      ? []
      : Array.isArray(v)
        ? v
        : Object.entries(v).map(([status, n]) => ({ status, count: n })),
  );

export const analyticsSchema = z.object({
  gross_sales: num,
  orders: count,
  net_earnings: num,
  commission_paid: num,
  discounts_given: num,
  average_order_value: num,
  cancelled_orders: count,
  orders_by_status: ordersByStatus,
  by_day: z
    .array(z.object({ day: z.string(), orders: count, sales: num }))
    .nullable()
    .transform((v) => v ?? []),
  top_products: z
    .array(
      z.object({
        product_id: z.string().nullable(),
        title: z.string().nullable(),
        quantity: count,
        revenue: num,
      }),
    )
    .nullable()
    .transform((v) => v ?? []),
});
export type SellerAnalytics = z.output<typeof analyticsSchema>;

export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export const customerSchema = z.object({
  customer_id: z.string(),
  full_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  country: z.string().nullable(),
  city: z.string().nullable(),
  orders_count: count,
  total_spent: num,
  last_order_at: z.string().nullable(),
});
export type SellerCustomer = z.output<typeof customerSchema>;

/** Readable error when a database function returns an unexpected shape. */
export class ShapeError extends Error {
  constructor(fn: string, issues: z.ZodIssue[]) {
    const fields = [...new Set(issues.map((i) => i.path.join(".") || "(root)"))].join(", ");
    super(`${fn} returned an unexpected shape (check: ${fields}).`);
  }
}

/** Blank must be an error: z.coerce alone turns "" into 0 (= "out of stock"). */
export const stockSchema = z.preprocess(
  (v) => (v == null || (typeof v === "string" && v.trim() === "") ? undefined : v),
  z.coerce
    .number({
      required_error: "Enter a whole number.",
      invalid_type_error: "Enter a whole number.",
    })
    .int("Enter a whole number.")
    .min(0, "Stock can't be negative.")
    .max(1_000_000, "That's more than we can store."),
);

export const LOW_STOCK_THRESHOLD = 5;

export type LowStockProduct = Pick<ProductRow, "id" | "title" | "stock" | "featured_image">;
export type CustomerOrder = OrderRow & {
  order_items: OrderItemRow[];
  stores: { name: string } | null;
};

export const sellerDashboardService = {
  /** One store (`storeId`) or all of the seller's stores (null). */
  analytics: async (days: AnalyticsRange, storeId: string | null): Promise<SellerAnalytics> => {
    const { data, error } = await supabase.rpc("seller_analytics", {
      p_days: days,
      p_store_id: storeId,
    });
    if (error) throw error;
    // Some PostgREST setups wrap a single JSON value in an array.
    const value: unknown = Array.isArray(data) && data.length === 1 ? data[0] : data;
    const parsed = analyticsSchema.safeParse(value);
    if (!parsed.success) throw new ShapeError("seller_analytics", parsed.error.issues);
    return parsed.data;
  },

  /** Customers of one store (`storeId`) or of all the seller's stores (null). */
  customers: async (storeId: string | null): Promise<SellerCustomer[]> => {
    const { data, error } = await supabase.rpc("seller_customers", { p_store_id: storeId });
    if (error) throw error;
    const parsed = z.array(customerSchema).safeParse(data ?? []);
    if (!parsed.success) throw new ShapeError("seller_customers", parsed.error.issues);
    return parsed.data;
  },

  /** This customer's orders in the given stores (RLS also limits to the seller's stores). */
  customerOrders: async (customerId: string, storeIds: string[]): Promise<CustomerOrder[]> => {
    if (!storeIds.length) return [];
    const { data, error } = await supabase
      .from("orders")
      .select("*, order_items(*), stores(name)")
      .eq("customer_id", customerId)
      .in("store_id", storeIds)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data as CustomerOrder[];
  },

  pendingOrdersCount: async (storeIds: string[]): Promise<number> => {
    if (!storeIds.length) return 0;
    const { count: n, error } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .in("store_id", storeIds)
      .eq("status", "pending");
    if (error) throw error;
    return n ?? 0;
  },

  /** Pending orders per store (for the switcher's "new orders elsewhere" dot). */
  pendingByStore: async (storeIds: string[]): Promise<Record<string, number>> => {
    const out: Record<string, number> = {};
    if (!storeIds.length) return out;
    const { data, error } = await supabase
      .from("orders")
      .select("store_id")
      .in("store_id", storeIds)
      .eq("status", "pending")
      .limit(1000);
    if (error) throw error;
    for (const r of (data ?? []) as { store_id: string }[])
      out[r.store_id] = (out[r.store_id] ?? 0) + 1;
    return out;
  },

  lowStock: async (storeIds: string[]): Promise<LowStockProduct[]> => {
    if (!storeIds.length) return [];
    const { data, error } = await supabase
      .from("products")
      .select("id, title, stock, featured_image")
      .in("store_id", storeIds)
      .eq("status", "active")
      .lte("stock", LOW_STOCK_THRESHOLD)
      .order("stock", { ascending: true })
      .limit(10);
    if (error) throw error;
    return data as LowStockProduct[];
  },

  /** Inventory: sets stock for one product (RLS limits this to the owner). */
  updateStock: async (productId: string, stock: unknown): Promise<number> => {
    const value = stockSchema.parse(stock);
    const { data, error } = await supabase
      .from("products")
      .update({ stock: value })
      .eq("id", productId)
      .select("id, stock");
    if (error) throw error;
    return Number(expectRows(data as { id: string; stock: number }[], "product").stock);
  },
};
