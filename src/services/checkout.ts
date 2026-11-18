import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { lineKey, type CartItem } from "./cart";
import { NotPermittedError } from "./errors";

// Orders are created ONLY by the `place_order` database function, which
// re-reads prices and stock on the server. The client never inserts orders
// and never sends prices or totals.

/**
 * Card payments (Stripe Checkout, hosted by Stripe) are switched on at build
 * time with VITE_STRIPE_ENABLED=true. Off by default: the app then behaves as
 * pay-on-delivery only. No Stripe key of any kind is needed in the browser.
 */
export const stripeEnabled = () => import.meta.env.VITE_STRIPE_ENABLED === "true";

export type PaymentProvider = "cod" | "stripe";
export type PaymentMethodId = PaymentProvider | "hesabpay";

export function paymentMethods(stripeOn = stripeEnabled()) {
  return [
    {
      id: "cod",
      label: "Pay on delivery",
      description: "Pay in cash when your order arrives.",
      enabled: true,
    },
    {
      id: "stripe",
      label: "Pay by card",
      description: stripeOn ? "Pay by card on Stripe's secure page." : "Coming soon",
      enabled: stripeOn,
    },
    { id: "hesabpay", label: "HesabPay", description: "Coming soon", enabled: false },
  ] as const satisfies readonly {
    id: PaymentMethodId;
    label: string;
    description: string;
    enabled: boolean;
  }[];
}

const isMethodEnabled = (id: string): id is PaymentProvider =>
  paymentMethods().some((m) => m.id === id && m.enabled);

/** Is any online method switched on? (Card, when VITE_STRIPE_ENABLED is "true".) */
export const onlinePaymentAvailable = () =>
  paymentMethods().some((m) => m.enabled && m.id !== "cod");

/**
 * Cash on delivery per cart: if any store in the cart has COD paused, COD
 * can't be used for this cart; without an online method the order can't be
 * placed at all (said plainly, never a silent failure).
 */
export function codRule(
  pausedStoreIds: readonly string[],
  onlineAvailable = onlinePaymentAvailable(),
) {
  const codAllowed = pausedStoreIds.length === 0;
  return { codAllowed, canPlace: codAllowed || onlineAvailable };
}

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
  discount_total: amount.default(0),
  currency: z.string().min(1).default("USD"),
  payment_provider: z.string().nullish(),
  orders: z
    .array(
      z.object({
        id: z.string().min(1),
        store_id: z.string().min(1),
        total: amount,
        discount: amount.default(0),
      }),
    )
    .min(1),
});
export type PlaceOrderResult = z.output<typeof placeOrderResultSchema>;

/** Same rule as the seller's Discounts form; the server is the source of truth. */
export const discountCodeSchema = z
  .string()
  .trim()
  .transform((s) => s.toUpperCase())
  .pipe(
    z.union([
      z.literal(""),
      z.string().regex(/^[A-Z0-9_-]{3,32}$/, "That doesn't look like a discount code."),
    ]),
  )
  .transform((s) => s || null);

export const INVALID_DISCOUNT_MESSAGE =
  "This discount code is not valid for the items in your cart";
/** True when place_order rejected the discount code (cart stays as it is). */
export const isInvalidDiscountError = (e: unknown) =>
  typeof (e as { message?: unknown } | null)?.message === "string" &&
  (e as { message: string }).message.includes(INVALID_DISCOUNT_MESSAGE);

export interface OrderItemInput {
  product_id: string;
  quantity: number;
  selected_color: string | null;
  selected_size: string | null;
}

/**
 * One entry per line (product + color + size): equal lines merged, invalid
 * quantities dropped; prices are not sent. place_order checks on the server
 * that each color/size is one of the product's own (exact match).
 */
export function toOrderItems(items: CartItem[]): OrderItemInput[] {
  const merged = new Map<string, OrderItemInput>();
  for (const i of items) {
    if (!Number.isInteger(i.quantity) || i.quantity < 1) continue;
    const key = lineKey(i);
    const prior = merged.get(key);
    if (prior) prior.quantity += i.quantity;
    else
      merged.set(key, {
        product_id: i.productId,
        quantity: i.quantity,
        selected_color: i.color ?? null,
        selected_size: i.size ?? null,
      });
  }
  return [...merged.values()];
}

export const checkoutService = {
  placeOrder: async (
    items: CartItem[],
    customer: CheckoutCustomerInput,
    provider: PaymentProvider = "cod",
    discountCode: string | null = null,
  ): Promise<PlaceOrderResult> => {
    if (!isMethodEnabled(provider)) throw new Error("That payment method isn't available yet.");
    const p_items = toOrderItems(items);
    if (!p_items.length) throw new Error("Your bag is empty.");
    const p_customer = checkoutCustomerSchema.parse(customer);
    const p_discount_code = discountCodeSchema.parse(discountCode ?? "");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new NotPermittedError("Please sign in to place your order.");

    const { data, error } = await supabase.rpc("place_order", {
      p_items,
      p_customer,
      p_payment_provider: provider,
      p_discount_code,
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
      .select("id, store_id, total, total_amount, currency, discount_amount, payment_provider")
      .eq("checkout_group_id", groupId);
    if (error) throw error;
    const rows = (data ?? []) as {
      id: string;
      store_id: string;
      total: number | string | null;
      total_amount: number | string | null;
      currency: string | null;
      discount_amount: number | string | null;
      payment_provider: string | null;
    }[];
    if (!rows.length) return null;
    const orders = rows.map((o) => ({
      id: o.id,
      store_id: o.store_id,
      total: Number(o.total ?? o.total_amount ?? 0),
      discount: Number(o.discount_amount ?? 0),
    }));
    // Cents-safe sums of the server-calculated values.
    const sum = (k: "total" | "discount") =>
      Math.round(orders.reduce((s, o) => s + o[k] * 100, 0)) / 100;
    return {
      checkout_group_id: groupId,
      total: sum("total"),
      discount_total: sum("discount"),
      currency: rows[0]?.currency ?? "USD",
      payment_provider: rows[0]?.payment_provider ?? null,
      orders,
    };
  },
};
