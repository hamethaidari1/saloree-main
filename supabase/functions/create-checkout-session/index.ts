// Creates a Stripe Checkout session for the PENDING Stripe orders of one checkout.
// Called by the signed-in customer's browser. The amounts come from our database, never from the browser.
import Stripe from "npm:stripe@18.5.0";
import { createClient } from "jsr:@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  httpClient: Stripe.createFetchHttpClient(),
});
const SITE_URL = (Deno.env.get("SITE_URL") ?? "").replace(/\/+$/, "");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const ALLOWED_ORIGINS = new Set([SITE_URL, "http://localhost:8080"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_PATH = /^\/(?!\/)[A-Za-z0-9\/_\-.~%]*(\?[A-Za-z0-9_\-.~%=&]*)?$/;

function cors(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : SITE_URL;
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  if (!SITE_URL.startsWith("https://") && !SITE_URL.startsWith("http://localhost")) {
    console.error("SITE_URL secret is missing or invalid");
    return json({ error: "Card payments are not configured yet" }, 503, origin);
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Please sign in" }, 401, origin);

    // the customer's own rights: RLS only returns their own orders
    const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: who } = await user.auth.getUser();
    if (!who?.user) return json({ error: "Please sign in" }, 401, origin);

    const body = await req.json().catch(() => ({}));
    const group = String(body.checkout_group_id ?? "");
    const successPath = String(body.success_path ?? "/");
    const cancelPath = String(body.cancel_path ?? "/checkout");
    if (!UUID.test(group)) return json({ error: "Invalid checkout" }, 400, origin);
    if (!SAFE_PATH.test(successPath) || !SAFE_PATH.test(cancelPath)) {
      return json({ error: "Invalid return address" }, 400, origin);
    }

    const { data: orders, error } = await user
      .from("orders")
      .select("id, store_id, total, currency, email, status, payment_provider, payment_status, stripe_checkout_session_id")
      .eq("checkout_group_id", group)
      .eq("customer_id", who.user.id);
    if (error) return json({ error: error.message }, 400, origin);
    if (!orders || orders.length === 0) return json({ error: "Checkout not found" }, 404, origin);

    if (orders.some((o) => o.payment_provider !== "stripe")) {
      return json({ error: "This checkout is not a card payment" }, 400, origin);
    }
    if (orders.every((o) => o.payment_status === "paid")) {
      return json({ error: "This checkout is already paid" }, 409, origin);
    }
    if (orders.some((o) => o.status === "cancelled" || o.payment_status !== "pending")) {
      return json({ error: "This checkout can no longer be paid. Please place the order again." }, 409, origin);
    }

    // reuse a session that is still open (page refresh, back button)
    const existing = orders.find((o) => o.stripe_checkout_session_id)?.stripe_checkout_session_id;
    if (existing) {
      try {
        const s = await stripe.checkout.sessions.retrieve(existing);
        if (s.status === "open" && s.url) return json({ url: s.url }, 200, origin);
      } catch (_) { /* create a new one below */ }
    }

    const currencies = new Set(orders.map((o) => String(o.currency ?? "USD").toLowerCase()));
    if (currencies.size !== 1) return json({ error: "Orders in different currencies cannot be paid together" }, 400, origin);
    const currency = [...currencies][0];
    if (!/^[a-z]{3}$/.test(currency)) return json({ error: "Unsupported currency" }, 400, origin);

    const total = orders.reduce((sum, o) => sum + Math.round(Number(o.total) * 100), 0);
    if (total < 50) return json({ error: "The total is below the minimum card payment" }, 400, origin);

    const ids = [...new Set(orders.map((o) => o.store_id))];
    const { data: stores } = await user.from("stores").select("id, name").in("id", ids);
    const names = new Map((stores ?? []).map((s) => [s.id, s.name as string]));

    const sep = (p: string) => (p.includes("?") ? "&" : "?");
    // Same bucket => identical parameters => Stripe returns the same session (no double charge,
    // no idempotency conflict). Created at the start..end of a bucket, the session lives 31..36 minutes.
    const bucket = Math.floor(Date.now() / 300000);
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        client_reference_id: group,
        customer_email: orders[0].email ?? undefined,
        line_items: orders.map((o) => ({
          quantity: 1,
          price_data: {
            currency,
            unit_amount: Math.round(Number(o.total) * 100),
            product_data: { name: `Order from ${names.get(o.store_id) ?? "Saloree store"}` },
          },
        })),
        metadata: { checkout_group_id: group },
        payment_intent_data: {
          metadata: { checkout_group_id: group },
          transfer_group: group, // lets us pay sellers through Stripe Connect later
        },
        expires_at: bucket * 300 + 36 * 60,
        success_url: `${SITE_URL}${successPath}${sep(successPath)}session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${SITE_URL}${cancelPath}`,
      },
      // a double click within 5 minutes returns the same session (no double charge)
      { idempotencyKey: `checkout-${group}-${bucket}` },
    );

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { error: attachError } = await admin.rpc("stripe_attach_session", { p_group: group, p_session: session.id });
    if (attachError) console.error("stripe_attach_session failed:", attachError.message); // the webhook still finds the orders by client_reference_id

    return json({ url: session.url }, 200, origin);
  } catch (e) {
    console.error("create-checkout-session failed:", e instanceof Error ? e.message : "unknown error");
    return json({ error: "Could not start the card payment. Please try again." }, 500, origin);
  }
});
