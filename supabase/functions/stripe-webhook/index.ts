// Receives Stripe events. The signature is verified first; nothing is trusted without it.
// Every event is processed once (stripe_events). Only this function can mark orders as paid.
import Stripe from "npm:stripe@18.5.0";
import { createClient } from "jsr:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  httpClient: Stripe.createFetchHttpClient(),
});
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const cryptoProvider = Stripe.createSubtleCryptoProvider(); // signature check with Deno's WebCrypto
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function note(eventId: string, text: string) {
  await admin.from("stripe_events").update({ note: text.slice(0, 500) }).eq("id", eventId);
}

async function markPaid(eventId: string, session: Stripe.Checkout.Session) {
  const group = session.client_reference_id ?? session.metadata?.checkout_group_id;
  if (!group) return note(eventId, "Session without checkout group");
  const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;

  const { data, error } = await admin.rpc("stripe_mark_group_paid", {
    p_group: group,
    p_session: session.id,
    p_payment_intent: pi,
    p_amount_cents: session.amount_total,
  });

  if (error) {
    if (error.message.includes("Amount mismatch") || error.message.includes("No Stripe orders")) {
      // retrying cannot fix this: a person must look at it
      return note(eventId, `NEEDS REVIEW (group ${group}): ${error.message}`);
    }
    throw new Error(error.message); // let Stripe retry
  }

  // money arrived for orders that were already cancelled (the session had expired): refund it
  if (data && data.paid === 0 && data.cancelled_before_payment > 0 && pi) {
    await stripe.refunds.create(
      { payment_intent: pi, reason: "requested_by_customer", metadata: { checkout_group_id: group, why: "paid_after_cancel" } },
      { idempotencyKey: `refund-late-${pi}` },
    );
    await note(eventId, `Paid after the orders were cancelled: refunded automatically (group ${group})`);
  }
}

async function cancelGroup(eventId: string, session: Stripe.Checkout.Session) {
  const group = session.client_reference_id ?? session.metadata?.checkout_group_id;
  if (!group) return note(eventId, "Session without checkout group");
  const { error } = await admin.rpc("stripe_cancel_group", { p_group: group });
  if (error) throw new Error(error.message);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  if (!WEBHOOK_SECRET) {
    console.error("STRIPE_WEBHOOK_SECRET is not set");
    return new Response("Webhook not configured", { status: 503 });
  }
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const raw = await req.text(); // the exact bytes Stripe signed
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(raw, signature, WEBHOOK_SECRET, undefined, cryptoProvider);
  } catch (_) {
    return new Response("Invalid signature", { status: 400 });
  }

  // handle each event once
  const { error: seen } = await admin.from("stripe_events").insert({ id: event.id, type: event.type });
  if (seen) {
    if (seen.code === "23505") return new Response("Already handled", { status: 200 });
    console.error("stripe_events insert failed:", seen.message);
    return new Response("Server error", { status: 500 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.payment_status === "paid") await markPaid(event.id, s);
        else await note(event.id, "Completed but not paid yet (waiting for the bank)");
        break;
      }
      case "checkout.session.async_payment_succeeded":
        await markPaid(event.id, event.data.object as Stripe.Checkout.Session);
        break;
      case "checkout.session.async_payment_failed":
      case "checkout.session.expired":
        await cancelGroup(event.id, event.data.object as Stripe.Checkout.Session);
        break;
      case "charge.refunded": {
        const c = event.data.object as Stripe.Charge;
        const pi = typeof c.payment_intent === "string" ? c.payment_intent : c.payment_intent?.id;
        if (!pi) break;
        if (c.refunded) {
          const { error } = await admin.rpc("stripe_mark_refunded", { p_payment_intent: pi });
          if (error) throw new Error(error.message);
        } else {
          await note(event.id, `PARTIAL REFUND on ${pi}: finance must adjust by hand`);
        }
        break;
      }
      default:
        break; // other events are not needed
    }
  } catch (e) {
    // forget the marker so Stripe's retry is processed
    await admin.from("stripe_events").delete().eq("id", event.id);
    console.error("webhook handler failed:", e instanceof Error ? e.message : "unknown error");
    return new Response("Handler error", { status: 500 });
  }

  return new Response("ok", { status: 200 });
});
