import { z } from "zod";
import { supabase } from "@/lib/supabase";
import type { CartItem } from "./cart";
import { NotPermittedError } from "./errors";

// Orders are created ONLY by the `place_order` database function, which
// re-reads prices and stock on the server. The client never inserts orders
// and never sends prices or totals.

export const PAYMENT_METHODS = [
  {
    id: "cod",
    label: "Pay on delivery",
    description: "Pay in cash when your order arrives.",
    enabled: true,
  },
  { id: "stripe", label: "Card (Stripe)", description: "Coming soon", enabled: false },
  { id: "hesabpay", label: "HesabPay", description: "Coming soon", enabled: false },
] as const;
export type PaymentProvider = Extract<(typeof PAYMENT_METHODS)[number], { enabled: true }>["id"];

const required = (label: string, min: number, max: number) =>
  z
    .string({ required_error: `Enter your ${label}.` })
    .trim()
    .min(min, min <= 1 ? `Enter your ${label}.` : `Your ${label} looks too short.`)
    .max(max, `Your ${label} is too long.`);

export const checkoutCustomerSchema = z.object({
  full_name: required("full name", 2, 100),
  phone: z
    .string({ required_error: "Enter your phone number." })
    .trim()
    .regex(/^\+?[0-9\s()-]{6,20}$/, "Enter a valid phone number."),
  email: z.string().trim().email("Enter a valid email address.").max(254),
  country: required("country", 2, 80),
  city: required("city", 1, 80),
  address: required("address", 5, 300),
  notes: z
    .string()
    .trim()
    .max(500, "Notes can be up to 500 characters.")
    .nullish()
    .transform((v) => v || null),
});
export type CheckoutCustomerInput = z.input<typeof checkoutCustomerSchema>;
export type CheckoutCustomer = z.output<typeof checkoutCustomerSchema>;

/** Numeric columns can arrive as strings from PostgREST. */
const amount = z.coerce.number().finite().nonnegative();

export const placeOrderResultSchema = z.object({
  checkout_group_id: z.string().min(1),
  total: amount,
  currency: z.string().min(1).default("USD"),
  orders: z
    .array(z.object({ id: z.string().min(1), store_id: z.string().min(1), total: amount }))
    .min(1),
});
export type PlaceOrderResult = z.output<typeof placeOrderResultSchema>;

/** Merges duplicate lines and drops invalid quantities; prices are not sent. */
export function toOrderItems(items: CartItem[]) {
  const merged = new Map<string, number>();
  for (const i of items)
    if (Number.isInteger(i.quantity) && i.quantity > 0)
      merged.set(i.productId, (merged.get(i.productId) ?? 0) + i.quantity);
  return [...merged].map(([product_id, quantity]) => ({ product_id, quantity }));
}

export const checkoutService = {
  placeOrder: async (
    items: CartItem[],
    customer: CheckoutCustomerInput,
    provider: PaymentProvider = "cod",
  ): Promise<PlaceOrderResult> => {
    if (!PAYMENT_METHODS.some((m) => m.id === provider && m.enabled))
      throw new Error("That payment method isn't available yet.");
    const p_items = toOrderItems(items);
    if (!p_items.length) throw new Error("Your bag is empty.");
    const p_customer = checkoutCustomerSchema.parse(customer);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new NotPermittedError("Please sign in to place your order.");

    const { data, error } = await supabase.rpc("place_order", {
      p_items,
      p_customer,
      p_payment_provider: provider,
    });
    if (error) throw error;
    const parsed = placeOrderResultSchema.safeParse(data);
    if (!parsed.success)
      // The order may exist; send the shopper to their orders rather than retrying.
      throw new Error("Your order was sent, but the confirmation was unreadable. Check My orders.");
    return parsed.data;
  },

  /** Rebuilds a confirmation from the saved orders (e.g. after a page reload). */
  getCheckoutGroup: async (groupId: string): Promise<PlaceOrderResult | null> => {
    const { data, error } = await supabase
      .from("orders")
      .select("id, store_id, total, total_amount, currency")
      .eq("checkout_group_id", groupId);
    if (error) throw error;
    const rows = (data ?? []) as {
      id: string;
      store_id: string;
      total: number | string | null;
      total_amount: number | string | null;
      currency: string | null;
    }[];
    if (!rows.length) return null;
    const orders = rows.map((o) => ({
      id: o.id,
      store_id: o.store_id,
      total: Number(o.total ?? o.total_amount ?? 0),
    }));
    return {
      checkout_group_id: groupId,
      // Cents-safe sum of the server-calculated order totals.
      total: Math.round(orders.reduce((s, o) => s + o.total * 100, 0)) / 100,
      currency: rows[0]?.currency ?? "USD",
      orders,
    };
  },
};
