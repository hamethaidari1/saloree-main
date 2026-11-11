import type { OrderItemRow, OrderRow, StoreRow } from "@/data/db";
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
  /** Orders received by one of the seller's stores (RLS must restrict to owners). */
  getStoreOrders: async (storeId: string): Promise<OrderWithItems[]> => {
    const { data, error } = await supabase
      .from("orders")
      .select(ORDER_SELECT)
      .eq("store_id", storeId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data as OrderWithItems[];
  },
};

export const sellerService = {
  /** Every store the signed-in user owns, including drafts. */
  getMyStores: async (): Promise<StoreRow[]> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const { data, error } = await supabase
      .from("stores")
      .select("*")
      .eq("owner_id", user.id)
      .order("created_at");
    if (error) throw error;
    return data as StoreRow[];
  },
};
