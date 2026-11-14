import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "./supabase-mock";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

import {
  CardPaymentError,
  PAYMENT_POLL,
  canPayNow,
  cardPaymentService,
  classifyPaymentRefusal,
  groupPaymentState,
  isStripeCheckoutUrl,
  orderPaymentState,
  paymentPaths,
  pollDelay,
  waitForPayment,
  type GroupPaymentRow,
} from "@/services/card-payment";
import { checkoutService, codRule, onlinePaymentAvailable } from "@/services/checkout";
import { clearPendingPayment, readPendingPayment, savePendingPayment } from "@/lib/pending-payment";

const m = () => mock.current!;
beforeEach(() => {
  m().reset();
  window.sessionStorage.clear();
  // The default build has cards off; don't depend on a developer's local .env.
  vi.stubEnv("VITE_STRIPE_ENABLED", "false");
});
afterEach(() => vi.unstubAllEnvs());

const STRIPE_URL = "https://checkout.stripe.com/c/pay/cs_test_a1";
const customer = {
  full_name: "Sara Ahmadi",
  phone: "+93 70 123 4567",
  email: "sara@example.com",
  country: "Afghanistan",
  city: "Kabul",
  address: "Street 1, House 2",
};
const placed = {
  checkout_group_id: "g-1",
  total: "35.00",
  currency: "USD",
  payment_provider: "stripe",
  orders: [{ id: "o-1", store_id: "s-1", total: "35.00" }],
};

describe("feature flag", () => {
  it("off by default: no online method, so COD-paused carts can't be placed", () => {
    expect(onlinePaymentAvailable()).toBe(false);
    expect(codRule(["s1"])).toEqual({ codAllowed: false, canPlace: false });
  });
  it('on only for exactly "true"', () => {
    vi.stubEnv("VITE_STRIPE_ENABLED", "yes");
    expect(onlinePaymentAvailable()).toBe(false);
    vi.stubEnv("VITE_STRIPE_ENABLED", "true");
    expect(onlinePaymentAvailable()).toBe(true);
    expect(codRule(["s1"])).toEqual({ codAllowed: false, canPlace: true });
  });
});

describe("place_order with the card provider", () => {
  it("is refused in the browser while the flag is off (no database call)", async () => {
    await expect(
      checkoutService.placeOrder([{ productId: "p1", quantity: 1 }], customer, "stripe"),
    ).rejects.toThrow(/isn't available/);
    expect(m().state.rpcs).toEqual([]);
  });
  it("sends p_payment_provider 'stripe' and no prices when the flag is on", async () => {
    vi.stubEnv("VITE_STRIPE_ENABLED", "true");
    m().state.queue.push({ data: placed });
    const r = await checkoutService.placeOrder(
      [{ productId: "p1", quantity: 2 }],
      customer,
      "stripe",
    );
    expect(r.checkout_group_id).toBe("g-1");
    const call = m().state.rpcs[0]!;
    expect(call.fn).toBe("place_order");
    expect(call.args).toMatchObject({
      p_payment_provider: "stripe",
      p_items: [{ product_id: "p1", quantity: 2 }],
    });
    expect(JSON.stringify(call.args)).not.toMatch(/price|total|amount/);
  });
});

describe("create-checkout-session", () => {
  it("is called with the checkout id and return paths only (never amounts)", async () => {
    m().state.queue.push({ data: { url: STRIPE_URL } });
    await expect(cardPaymentService.startPayment("g-1")).resolves.toBe(STRIPE_URL);
    expect(m().state.invokes).toEqual([
      {
        name: "create-checkout-session",
        body: {
          checkout_group_id: "g-1",
          success_path: "/order-confirmation?group=g-1",
          cancel_path: "/checkout",
        },
      },
    ]);
  });
  it("return paths are paths on this site", () => {
    const p = paymentPaths("a b/c");
    expect(p.success_path).toBe("/order-confirmation?group=a%20b%2Fc");
    for (const v of Object.values(p)) expect(v.startsWith("/") && !v.startsWith("//")).toBe(true);
  });
  it("passes the function's { error } text through as it is", async () => {
    m().state.queue.push({ data: { error: "Stripe is not configured on the server" } });
    await expect(cardPaymentService.startPayment("g-1")).rejects.toMatchObject({
      name: "CardPaymentError",
      message: "Stripe is not configured on the server",
      problem: "other",
    });
  });
  it("reads { error } from a non-2xx reply and recognises an expired checkout", async () => {
    m().state.queue.push({
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: new Response(JSON.stringify({ error: "This checkout has expired" }), {
          status: 409,
        }),
      },
    });
    const e = await cardPaymentService.startPayment("g-1").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(CardPaymentError);
    expect(e).toMatchObject({
      message: "This checkout has expired",
      problem: "expired",
      status: 409,
    });
  });
  it("a function that isn't deployed yet shows the real message", async () => {
    m().state.queue.push({
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: new Response(
          JSON.stringify({ code: "NOT_FOUND", message: "Requested function was not found" }),
          { status: 404 },
        ),
      },
    });
    await expect(cardPaymentService.startPayment("g-1")).rejects.toThrow(
      "Requested function was not found",
    );
  });
  it("never opens an address that is not Stripe's (https)", async () => {
    m().state.queue.push({ data: { url: "https://evil.example/pay" } });
    await expect(cardPaymentService.startPayment("g-1")).rejects.toThrow(/looked wrong/);
    expect(isStripeCheckoutUrl(STRIPE_URL)).toBe(true);
    expect(isStripeCheckoutUrl("http://checkout.stripe.com/x")).toBe(false);
    expect(isStripeCheckoutUrl("https://stripe.com.evil.io/x")).toBe(false);
    expect(isStripeCheckoutUrl("javascript:alert(1)")).toBe(false);
  });
  it("needs a signed-in customer (no call without a session)", async () => {
    m().state.session = null;
    await expect(cardPaymentService.startPayment("g-1")).rejects.toMatchObject({
      code: "42501",
    });
    expect(m().state.invokes).toEqual([]);
  });
  it("classifies refusals", () => {
    expect(classifyPaymentRefusal("Checkout session expired")).toBe("expired");
    expect(classifyPaymentRefusal("These orders were cancelled")).toBe("expired");
    expect(classifyPaymentRefusal("This checkout can no longer be paid")).toBe("expired");
    expect(classifyPaymentRefusal("This checkout has already been paid")).toBe("paid");
    expect(classifyPaymentRefusal("whatever", 410)).toBe("expired");
    expect(classifyPaymentRefusal("Not signed in")).toBe("other");
  });
});

const row = (patch: Partial<GroupPaymentRow> = {}): GroupPaymentRow => ({
  id: "o-1",
  status: "pending",
  payment_status: "pending",
  payment_provider: "stripe",
  ...patch,
});

describe("payment state in words", () => {
  it.each([
    [{}, "awaiting"],
    [{ payment_status: null }, "awaiting"],
    [{ payment_status: "paid", status: "processing" }, "paid"],
    [{ payment_status: "refunded" }, "refunded"],
    [{ payment_status: "failed" }, "failed"],
    [{ status: "cancelled" }, "notCompleted"],
    [{ payment_status: "expired" }, "notCompleted"],
    [{ payment_provider: "cod" }, "cod"],
    [{ payment_provider: null, payment_status: null }, "cod"],
  ] as const)("%j → %s", (patch, state) => {
    expect(orderPaymentState(row(patch))).toBe(state);
  });
  it("Pay now only for a pending, unpaid card order of a checkout", () => {
    const o = { ...row(), checkout_group_id: "g-1" };
    expect(canPayNow(o)).toBe(true);
    expect(canPayNow({ ...o, checkout_group_id: null })).toBe(false);
    expect(canPayNow({ ...o, payment_status: "paid" })).toBe(false);
    expect(canPayNow({ ...o, status: "cancelled" })).toBe(false);
    expect(canPayNow({ ...o, payment_status: "failed" })).toBe(false);
    expect(canPayNow({ ...o, payment_provider: "cod" })).toBe(false);
  });
  it("a checkout is paid only when every order is", () => {
    expect(groupPaymentState([])).toBe("none");
    expect(groupPaymentState([row({ payment_status: "paid" }), row()])).toBe("pending");
    expect(
      groupPaymentState([row({ payment_status: "paid" }), row({ payment_status: "paid" })]),
    ).toBe("paid");
    expect(groupPaymentState([row(), row({ status: "cancelled" })])).toBe("failed");
  });
});

describe("waiting for the webhook", () => {
  const clock = () => {
    let t = 0;
    const sleeps: number[] = [];
    return {
      sleeps,
      now: () => t,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        t += ms;
      },
    };
  };
  it("polls the checkout until it is paid", async () => {
    const c = clock();
    const load = vi
      .fn<() => Promise<GroupPaymentRow[]>>()
      .mockResolvedValueOnce([row()])
      .mockRejectedValueOnce(new Error("network")) // retried, not shown
      .mockResolvedValueOnce([row({ payment_status: "paid" })]);
    await expect(waitForPayment(load, c)).resolves.toBe("paid");
    expect(load).toHaveBeenCalledTimes(3);
    expect(c.sleeps).toEqual([2000, 2000]);
  });
  it("stops when the checkout ended (cancelled / expired)", async () => {
    const c = clock();
    const load = vi.fn(async () => [row({ status: "cancelled" })]);
    await expect(waitForPayment(load, c)).resolves.toBe("failed");
  });
  it("gives up after 60 s, backing off up to 8 s between reads", async () => {
    const c = clock();
    const load = vi.fn(async () => [row()]);
    await expect(waitForPayment(load, c)).resolves.toBe("timeout");
    expect(c.now()).toBe(PAYMENT_POLL.limitMs);
    expect(c.sleeps.slice(0, 5)).toEqual([2000, 2000, 2000, 3000, 4500]);
    expect(Math.max(...c.sleeps)).toBe(8000);
    expect(pollDelay(50)).toBe(8000);
  });
  it("stops when the page is left", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(waitForPayment(vi.fn(), { signal: ctrl.signal })).resolves.toBe("aborted");
  });
});

describe("remembered card payment (this tab only)", () => {
  it("stores only the checkout id and forgets it after the reservation time", () => {
    savePendingPayment("g-1", 1000);
    expect(JSON.parse(window.sessionStorage.getItem("saloree.card-payment")!)).toEqual({
      groupId: "g-1",
      at: 1000,
    });
    expect(readPendingPayment(1000 + 60_000)).toEqual({ groupId: "g-1", at: 1000 });
    expect(readPendingPayment(1000 + 36 * 60_000)).toBeNull();
  });
  it("clears only the matching checkout", () => {
    savePendingPayment("g-1");
    clearPendingPayment("g-2");
    expect(readPendingPayment()?.groupId).toBe("g-1");
    clearPendingPayment("g-1");
    expect(readPendingPayment()).toBeNull();
  });
  it("ignores broken stored values", () => {
    window.sessionStorage.setItem("saloree.card-payment", "{not json");
    expect(readPendingPayment()).toBeNull();
  });
});

describe("no Stripe secrets in the project", () => {
  // Built from parts so this file doesn't match itself.
  const secret = new RegExp(["s", "k_"].join("") + "|" + ["wh", "sec_"].join(""));
  const root = join(__dirname, "..", "..");
  const skip = new Set([
    "node_modules",
    "dist",
    ".git",
    ".output",
    ".vinxi",
    ".tanstack",
    "coverage",
  ]);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (
        s.size < 2_000_000 &&
        /\.(ts|tsx|js|mjs|cjs|json|css|html|md|toml|sql)$|^\.env/.test(name)
      )
        files.push(p);
    }
  };
  walk(root);
  it("scans the app, tests, functions and env files", () => {
    const rel = files.map((f) => relative(root, f).replace(/\\/g, "/"));
    expect(rel).toContain(".env.example");
    expect(rel).toContain("src/services/card-payment.ts");
  });
  it("finds no secret key or webhook secret prefix", () => {
    const hits = files.filter((f) => secret.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => relative(root, f))).toEqual([]);
  });
});
