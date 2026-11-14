import { z } from "zod";
import type { OrderRow } from "@/data/db";
import { supabase } from "@/lib/supabase";
import { NotPermittedError } from "./errors";

// Card payments run on Stripe's hosted Checkout page. The browser never sees
// card data, never sends amounts and never marks anything paid:
//  1. place_order (provider 'stripe') creates PENDING orders and reserves stock;
//  2. the Edge Function create-checkout-session reads the totals from the
//     database, checks the checkout belongs to the signed-in customer, and
//     returns Stripe's page address;
//  3. the stripe-webhook Edge Function marks the orders paid.

/** Where Stripe sends the customer back (paths only; the function adds the site). */
export const paymentPaths = (checkoutGroupId: string) => ({
  success_path: `/order-confirmation?group=${encodeURIComponent(checkoutGroupId)}`,
  cancel_path: "/checkout",
});

/** Only open Stripe-hosted pages over https (never an arbitrary address). */
export const isStripeCheckoutUrl = (value: string) => {
  try {
    const u = new URL(value);
    return (
      u.protocol === "https:" && (u.hostname === "stripe.com" || u.hostname.endsWith(".stripe.com"))
    );
  } catch {
    return false;
  }
};

const sessionReply = z.union([
  z.object({ url: z.string().min(1) }),
  z.object({ error: z.string().min(1) }),
]);

export type CardPaymentProblem = "expired" | "paid" | "other";

/** A refusal from create-checkout-session; `message` is its text, as written. */
export class CardPaymentError extends Error {
  constructor(
    message: string,
    readonly problem: CardPaymentProblem = "other",
    readonly status?: number,
  ) {
    super(message);
    this.name = "CardPaymentError";
  }
}

/**
 * What kind of refusal it is. The function answers with plain text; a
 * checkout that is expired / cancelled can no longer be paid (place it again),
 * one already paid needs no payment.
 */
export function classifyPaymentRefusal(message: string, status?: number): CardPaymentProblem {
  if (/already\s+(been\s+)?paid/i.test(message)) return "paid";
  if (
    status === 410 ||
    /expired|cancell?ed|no longer|can(no|')t be paid|not payable/i.test(message)
  )
    return "expired";
  return "other";
}

/** Reads `{ error }` from a non-2xx function reply without logging it. */
async function refusalOf(error: unknown): Promise<CardPaymentError> {
  // FunctionsHttpError carries the function's Response as `context`.
  const ctx = (error as { context?: Partial<Response> } | null)?.context;
  let status: number | undefined;
  let text = "";
  if (ctx && typeof ctx.clone === "function" && typeof ctx.status === "number") {
    status = ctx.status;
    try {
      const body: unknown = await ctx.clone().json();
      const b = body as { error?: unknown; message?: unknown } | null;
      text =
        typeof b?.error === "string" ? b.error : typeof b?.message === "string" ? b.message : "";
    } catch {
      try {
        text = (await ctx.clone().text()).trim().slice(0, 300);
      } catch {
        text = "";
      }
    }
  }
  if (!text) {
    const m = (error as { message?: unknown } | null)?.message;
    text = typeof m === "string" && m.trim() ? m : "The payment page could not be opened.";
  }
  return new CardPaymentError(text, classifyPaymentRefusal(text, status), status);
}

export const cardPaymentService = {
  /**
   * Asks the server for Stripe's page for this checkout (it reuses an open
   * session). Returns the address to send the browser to.
   */
  startPayment: async (checkoutGroupId: string): Promise<string> => {
    const id = checkoutGroupId.trim();
    if (!id) throw new CardPaymentError("This checkout can't be paid.");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new NotPermittedError("Please sign in to pay for your order.");
    const { data, error } = await supabase.functions.invoke("create-checkout-session", {
      body: { checkout_group_id: id, ...paymentPaths(id) },
    });
    if (error) throw await refusalOf(error);
    const reply = sessionReply.safeParse(data);
    if (!reply.success) throw new CardPaymentError("The payment page could not be opened.");
    if ("error" in reply.data)
      throw new CardPaymentError(reply.data.error, classifyPaymentRefusal(reply.data.error));
    if (!isStripeCheckoutUrl(reply.data.url))
      throw new CardPaymentError("The payment page address looked wrong, so it was not opened.");
    return reply.data.url;
  },

  /** Payment state of the orders of one checkout (RLS: only the customer's own). */
  groupPayment: async (checkoutGroupId: string): Promise<GroupPaymentRow[]> => {
    const { data, error } = await supabase
      .from("orders")
      .select("id, status, payment_status, payment_provider")
      .eq("checkout_group_id", checkoutGroupId);
    if (error) throw error;
    return (data ?? []) as GroupPaymentRow[];
  },
};

export type GroupPaymentRow = Pick<
  OrderRow,
  "id" | "status" | "payment_status" | "payment_provider"
>;

export type PaymentState = "awaiting" | "paid" | "refunded" | "failed" | "notCompleted" | "cod";

const isCard = (o: Pick<OrderRow, "payment_provider">) => o.payment_provider === "stripe";

/** One order's payment, in words the customer sees (orders:payment.<state>). */
export function orderPaymentState(
  o: Pick<OrderRow, "payment_provider" | "payment_status" | "status">,
): PaymentState {
  const p = (o.payment_status ?? "").toLowerCase();
  if (p === "paid") return "paid";
  if (p === "refunded" || p === "partially_refunded") return "refunded";
  if (!isCard(o)) return "cod";
  if (p === "failed") return "failed";
  if (o.status === "cancelled" || p === "expired" || p === "cancelled" || p === "canceled")
    return "notCompleted";
  return "awaiting";
}

/** An unpaid card order may still be paid while it is pending. */
export const canPayNow = (
  o: Pick<OrderRow, "payment_provider" | "payment_status" | "status" | "checkout_group_id">,
) => !!o.checkout_group_id && o.status === "pending" && orderPaymentState(o) === "awaiting";

/** Whole checkout: paid only when every order is; any not-completed one ends it. */
export function groupPaymentState(rows: GroupPaymentRow[]): "paid" | "pending" | "failed" | "none" {
  if (!rows.length) return "none";
  const states = rows.map(orderPaymentState);
  if (states.every((s) => s === "paid" || s === "cod")) return "paid";
  if (states.some((s) => s === "failed" || s === "notCompleted" || s === "refunded"))
    return "failed";
  return "pending";
}

/** Polling: every 2 s at first, then slower (backoff), never above 8 s. */
export const PAYMENT_POLL = { firstMs: 2000, maxMs: 8000, limitMs: 60_000 };
export const pollDelay = (attempt: number) =>
  Math.min(PAYMENT_POLL.firstMs * 1.5 ** Math.max(0, attempt - 2), PAYMENT_POLL.maxMs);

/**
 * Re-reads the checkout until the webhook has marked it paid (or it ended),
 * for at most PAYMENT_POLL.limitMs. A failed read is retried, not shown.
 */
export async function waitForPayment(
  load: () => Promise<GroupPaymentRow[]>,
  {
    signal,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
    now = () => Date.now(),
  }: { signal?: AbortSignal; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<"paid" | "failed" | "none" | "timeout" | "aborted"> {
  const start = now();
  for (let attempt = 0; ; attempt++) {
    if (signal?.aborted) return "aborted";
    try {
      const state = groupPaymentState(await load());
      if (state !== "pending") return state;
    } catch {
      // Network or temporary error: keep trying until the time limit.
    }
    const left = PAYMENT_POLL.limitMs - (now() - start);
    if (left <= 0) return "timeout";
    await sleep(Math.min(pollDelay(attempt), left));
  }
}
