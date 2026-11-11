import type { OrderItemRow, OrderRow } from "@/data/db";
import { supabase } from "@/lib/supabase";

export type OrderWithItems = OrderRow & {
  order_items: OrderItemRow[];
  stores?: { name: string; slug: string } | null;
};

/**
 * Display total. `place_order` reports `total`, so prefer it; fall back to the
 * older `total_amount` / `subtotal` columns.
 */
export const orderTotal = (o: Pick<OrderRow, "total" | "total_amount" | "subtotal">) =>
  Number(o.total ?? o.total_amount ?? o.subtotal ?? 0);

/** Unit price and line amount for an order item, from whichever columns are set. */
export function lineAmounts(i: Pick<OrderItemRow, "quantity" | "price" | "unit_price" | "total">) {
  const unit = Number(i.unit_price ?? i.price ?? 0);
  const line = i.total != null ? Number(i.total) : Math.round(unit * i.quantity * 100) / 100;
  return { unit, line };
}

/** One-line shipping address from the separate columns (or the legacy JSON). */
export function formatAddress(
  o: Pick<OrderRow, "address" | "city" | "country" | "shipping_address">,
) {
  const parts = [o.address, o.city, o.country].filter((p): p is string => !!p?.trim());
  if (parts.length) return parts.join(", ");
  if (typeof o.shipping_address === "string") return o.shipping_address;
  if (o.shipping_address && typeof o.shipping_address === "object")
    return Object.values(o.shipping_address as Record<string, unknown>)
      .filter((v) => typeof v === "string" && v.trim())
      .join(", ");
  return "";
}

/** Customers may cancel only while the order is still pending. */
export const canCancel = (o: Pick<OrderRow, "status">) => o.status === "pending";

export const ordersService = {
  /** Orders placed by the signed-in customer. */
  getMyOrders: async (): Promise<OrderWithItems[]> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from("orders")
      .select("*, order_items(*), stores(name, slug)")
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data as OrderWithItems[];
  },

  /** Cancellation runs in the database (`cancel_my_order`), which re-checks ownership and status. */
  cancelMyOrder: async (orderId: string): Promise<void> => {
    const { error } = await supabase.rpc("cancel_my_order", { p_order_id: orderId });
    if (error) throw error;
  },
};
// Seller-side reads and writes live in src/services/seller.ts.
