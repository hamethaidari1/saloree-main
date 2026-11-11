import type { OrderItemRow, OrderRow } from "@/data/db";
import { supabase } from "@/lib/supabase";

export type OrderWithItems = OrderRow & { order_items: OrderItemRow[] };

const ORDER_SELECT = "*, order_items(*)";

/** Display total; the table has both `total` and `total_amount`. */
export const orderTotal = (o: OrderRow) => Number(o.total_amount ?? o.total ?? o.subtotal ?? 0);

export const ordersService = {
  /** Orders placed by the signed-in customer. */
  getMyOrders: async (): Promise<OrderWithItems[]> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from("orders")
      .select(ORDER_SELECT)
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data as OrderWithItems[];
  },
};
// Seller-side reads and writes live in src/services/seller.ts.
