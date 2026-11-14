import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  type AnyRoute,
} from "@tanstack/react-router";
import { createSupabaseMock } from "./supabase-mock";
import { testQueryClient } from "./router-harness";
import { WithLocale } from "./i18n";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});
const h = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  clear: vi.fn(),
  goTo: vi.fn(),
  paused: [] as string[],
}));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/components/marketplace/cart-context", () => ({
  useCart: () => ({
    items: [
      { productId: "p1", quantity: 1 },
      { productId: "p2", quantity: 1 },
    ],
    ready: true,
    clear: h.clear,
    add: vi.fn(),
    setQuantity: vi.fn(),
  }),
}));
vi.mock("@/services/payouts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/payouts")>()),
  codPausedStores: async () => h.paused,
}));
vi.mock("@/lib/pending-payment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pending-payment")>()),
  goToPaymentPage: h.goTo,
}));

import { Route as CheckoutRoute } from "@/routes/checkout";
import { Route as AccountRoute } from "@/routes/account";
import { Route as ReturnRoute } from "@/routes/order-confirmation.index";
import { OrdersPanel } from "@/components/seller/orders-panel";
import { PAYMENT_POLL } from "@/services/card-payment";
import { readPendingPayment, savePendingPayment } from "@/lib/pending-payment";
import type { Catalog } from "@/data/catalog";
import type { StoreRow } from "@/data/db";

const m = () => mock.current!;
const STRIPE_URL = "https://checkout.stripe.com/c/pay/cs_test_a1";
const poll = { ...PAYMENT_POLL };
beforeEach(() => {
  m().reset();
  window.sessionStorage.clear();
  h.toast.error.mockClear();
  h.clear.mockClear();
  h.goTo.mockClear();
  h.paused = [];
  vi.stubEnv("VITE_STRIPE_ENABLED", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
  Object.assign(PAYMENT_POLL, poll);
});

const product = (id: string, storeSlug: string, price: number) => ({
  id,
  title: id === "p1" ? "Lamp" : "Vase",
  price,
  rating: 0,
  reviews: 0,
  storeSlug,
  category: "",
  image: "x",
  stock: 5,
  description: "",
});
const store = (id: string, slug: string, name: string) => ({
  id,
  slug,
  name,
  initials: "x",
  description: "",
  rating: 0,
  specialty: "",
  image: "",
  logo: null,
  banner: null,
  tone: "sage" as const,
});
const catalog: Catalog = {
  products: [product("p1", "alpha", 20), product("p2", "beta", 15)],
  stores: [store("store-a", "alpha", "Alpha Home"), store("store-b", "beta", "Beta Decor")],
  categories: [],
};

/** Renders one real route component inside a small router (with /cart for redirects). */
function renderRoute(make: (root: AnyRoute) => AnyRoute[], path: string) {
  const qc = testQueryClient();
  qc.setQueryData(["catalog"], catalog);
  const root = createRootRoute();
  const cart = createRoute({
    getParentRoute: () => root,
    path: "/cart",
    component: () => <h1>Bag page</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([cart, ...make(root)]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <WithLocale>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </WithLocale>,
  );
  return { router, qc };
}
const user = { id: "user-1", email: "s@x.io", user_metadata: {} };

const renderCheckout = () =>
  renderRoute(
    (root) => [
      createRoute({
        getParentRoute: () => root,
        path: "/checkout",
        beforeLoad: () => ({ user }),
        component: CheckoutRoute.options.component!,
      }),
    ],
    "/checkout",
  );

const fillForm = () => {
  for (const [label, value] of [
    [/full name/i, "Sara Ahmadi"],
    [/phone/i, "+93 70 123 4567"],
    [/country/i, "Afghanistan"],
    [/city/i, "Kabul"],
    [/address/i, "Street 1, House 2"],
  ] as const)
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
};
const placed = {
  checkout_group_id: "g-1",
  total: "35.00",
  currency: "USD",
  payment_provider: "stripe",
  orders: [{ id: "o-1", store_id: "store-a", total: "35.00" }],
};

describe("checkout: pay by card", () => {
  it("flag off: the card option is not selectable and the app works as before", async () => {
    vi.stubEnv("VITE_STRIPE_ENABLED", "false");
    renderCheckout();
    expect(await screen.findByRole("radio", { name: /pay by card/i })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /pay on delivery/i })).toBeChecked();
    expect(screen.getByRole("button", { name: /place order/i })).toBeEnabled();
  });

  it("places the order with provider stripe, then opens Stripe's page", async () => {
    renderCheckout();
    fireEvent.click(await screen.findByRole("radio", { name: /pay by card/i }));
    fillForm();
    m().state.queue.push({ data: placed }, { data: { url: STRIPE_URL } });
    fireEvent.click(screen.getByRole("button", { name: /continue to payment/i }));
    await waitFor(() => expect(h.goTo).toHaveBeenCalledWith(STRIPE_URL));
    expect(m().state.rpcs[0]).toMatchObject({
      fn: "place_order",
      args: { p_payment_provider: "stripe" },
    });
    expect(m().state.invokes[0]?.body).toEqual({
      checkout_group_id: "g-1",
      success_path: "/order-confirmation?group=g-1",
      cancel_path: "/checkout",
    });
    expect(readPendingPayment()?.groupId).toBe("g-1");
    expect(h.clear).not.toHaveBeenCalled(); // emptied only once the payment is confirmed
  });

  it("shows the function's error text as it is and offers to try again", async () => {
    renderCheckout();
    fireEvent.click(await screen.findByRole("radio", { name: /pay by card/i }));
    fillForm();
    m().state.queue.push(
      { data: placed },
      { data: { error: "Stripe is not configured on the server" } },
      {
        data: [
          { id: "o-1", status: "pending", payment_status: "pending", payment_provider: "stripe" },
        ],
      },
    );
    fireEvent.click(screen.getByRole("button", { name: /continue to payment/i }));
    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith("Stripe is not configured on the server"),
    );
    expect(h.goTo).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: /try payment again/i })).toBeTruthy();
  });

  it("with a COD-paused store, pay by card is selected and the order can be placed", async () => {
    h.paused = ["store-b"];
    renderCheckout();
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /pay on delivery/i })).toBeDisabled(),
    );
    expect(screen.getByRole("radio", { name: /pay by card/i })).toBeChecked();
    expect(screen.getByRole("button", { name: /continue to payment/i })).toBeEnabled();
    expect(
      screen.getAllByText(/Cash on delivery is paused for: Beta Decor/).length,
    ).toBeGreaterThan(0);
  });
});

describe("checkout: back from Stripe without paying", () => {
  const pendingRows = {
    data: [{ id: "o-1", status: "pending", payment_status: "pending", payment_provider: "stripe" }],
  };

  it("shows the reserved notice; Try payment again reuses the same checkout", async () => {
    savePendingPayment("g-1");
    m().state.queue.push(pendingRows);
    renderCheckout();
    expect(
      await screen.findByText(
        "Your payment was not completed. Your items are reserved for a short time.",
      ),
    ).toBeTruthy();
    // No second order while the first one is waiting for payment.
    expect(screen.getByRole("button", { name: /continue to payment|place order/i })).toBeDisabled();
    m().state.queue.push({ data: { url: STRIPE_URL } });
    fireEvent.click(screen.getByRole("button", { name: /try payment again/i }));
    await waitFor(() => expect(h.goTo).toHaveBeenCalledWith(STRIPE_URL));
    expect(m().state.invokes[0]?.body).toMatchObject({ checkout_group_id: "g-1" });
    expect(m().state.rpcs).toEqual([]); // place_order not called again
  });

  it("an expired checkout: tells the customer and goes back to the bag", async () => {
    savePendingPayment("g-1");
    m().state.queue.push(pendingRows, {
      error: {
        message: "Edge Function returned a non-2xx status code",
        context: new Response(JSON.stringify({ error: "This checkout has expired" }), {
          status: 409,
        }),
      },
    });
    renderCheckout();
    fireEvent.click(await screen.findByRole("button", { name: /try payment again/i }));
    expect(await screen.findByRole("heading", { name: "Bag page" })).toBeTruthy();
    expect(h.toast.error).toHaveBeenCalledWith(
      "That checkout can no longer be paid. Please place your order again from your bag.",
    );
    expect(readPendingPayment()).toBeNull();
  });

  it("no notice when the remembered checkout was paid meanwhile", async () => {
    savePendingPayment("g-1");
    m().state.queue.push({
      data: [
        { id: "o-1", status: "processing", payment_status: "paid", payment_provider: "stripe" },
      ],
    });
    renderCheckout();
    await screen.findByRole("radio", { name: /pay by card/i });
    await waitFor(() => expect(readPendingPayment()).toBeNull());
    expect(screen.queryByRole("button", { name: /try payment again/i })).toBeNull();
  });
});

const renderReturn = (group: string) =>
  renderRoute((root) => {
    const parent = createRoute({ getParentRoute: () => root, path: "order-confirmation" });
    return [
      parent.addChildren([
        createRoute({
          getParentRoute: () => parent,
          path: "/",
          validateSearch: ReturnRoute.options.validateSearch,
          component: ReturnRoute.options.component!,
        }),
      ]),
    ];
  }, `/order-confirmation?group=${group}&session_id=cs_test_ignored`);

describe("success return: confirming the payment", () => {
  beforeEach(() => Object.assign(PAYMENT_POLL, { firstMs: 5, maxMs: 5, limitMs: 80 }));
  const pending = {
    id: "o-1",
    status: "pending",
    payment_status: "pending",
    payment_provider: "stripe",
  };

  it("waits for the webhook, then shows the normal confirmation and empties the bag", async () => {
    savePendingPayment("g-1");
    m().state.queue.push(
      { data: [pending] },
      { data: [{ ...pending, status: "processing", payment_status: "paid" }] },
      {
        data: [
          {
            id: "o-1",
            store_id: "store-a",
            total: "35.00",
            total_amount: null,
            currency: "USD",
            discount_amount: "0",
            payment_provider: "stripe",
          },
        ],
      },
    );
    renderReturn("g-1");
    expect(await screen.findByText("Payment received, confirming your order…")).toBeTruthy();
    expect(
      await screen.findByRole("heading", { name: "Thank you — your order is placed" }),
    ).toBeTruthy();
    expect(screen.getByText("Total paid")).toBeTruthy();
    expect(h.clear).toHaveBeenCalledTimes(1);
    expect(readPendingPayment()).toBeNull();
    // Only reads: nothing is marked paid from the browser.
    for (const q of m().state.queries) expect(q.calls.map((c) => c[0])).not.toContain("update");
    expect(m().state.rpcs).toEqual([]);
  });

  it("still pending after the time limit: says so plainly", async () => {
    m().state.fallback = { data: [pending] };
    renderReturn("g-1");
    expect(
      await screen.findByText(
        /We are still confirming your payment\. You can safely close this page/,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/contact support/)).toBeTruthy();
    expect(h.clear).not.toHaveBeenCalled();
  });

  it("a cancelled / expired checkout: payment not completed, back to the bag", async () => {
    m().state.queue.push({ data: [{ ...pending, status: "cancelled" }] });
    renderReturn("g-1");
    expect(
      await screen.findByRole("heading", { name: "Payment not completed — order cancelled" }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to your bag" })).toBeTruthy();
  });
});

const order = (id: string, patch: Record<string, unknown>) => ({
  id,
  customer_id: "user-1",
  store_id: "store-a",
  status: "pending",
  subtotal: 20,
  total: 20,
  total_amount: null,
  payment_status: "pending",
  payment_provider: "stripe",
  checkout_group_id: `g-${id}`,
  currency: "USD",
  discount_code: null,
  discount_amount: null,
  commission_percent: null,
  commission_amount: null,
  seller_amount: null,
  country: null,
  city: null,
  address: null,
  shipping_address: null,
  full_name: "Sara",
  email: null,
  phone: null,
  notes: null,
  created_at: "2026-11-10T10:00:00Z",
  updated_at: "2026-11-10T10:00:00Z",
  order_items: [],
  stores: null,
  ...patch,
});
const myOrders = [
  order("aaaaaaaa1", {}),
  order("bbbbbbbb2", { status: "processing", payment_status: "paid" }),
  order("cccccccc3", { status: "cancelled" }),
  order("dddddddd4", { payment_status: "refunded", status: "cancelled" }),
  order("eeeeeeee5", { payment_provider: "cod", payment_status: "pending" }),
];
const renderAccount = () =>
  renderRoute(
    (root) => [
      createRoute({
        getParentRoute: () => root,
        path: "/account",
        beforeLoad: () => ({ user }),
        component: AccountRoute.options.component!,
      }),
    ],
    "/account",
  );
const card = (id: string) =>
  screen.getByText(`Order #${id.slice(0, 8)}`).closest("li") as HTMLElement;

describe("My orders: payment state", () => {
  it("shows the payment in words and Pay now only for payable card orders", async () => {
    m().state.queue.push({ data: myOrders });
    renderAccount();
    await screen.findByText("Order #aaaaaaaa");
    expect(within(card("aaaaaaaa1")).getByText("Awaiting payment")).toBeTruthy();
    expect(within(card("aaaaaaaa1")).getByRole("button", { name: "Pay now" })).toBeTruthy();
    expect(within(card("bbbbbbbb2")).getByText("Paid")).toBeTruthy();
    expect(
      within(card("cccccccc3")).getByText("Payment not completed — order cancelled"),
    ).toBeTruthy();
    expect(within(card("dddddddd4")).getByText("Refunded")).toBeTruthy();
    expect(within(card("eeeeeeee5")).getByText("Pay on delivery")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Pay now" })).toHaveLength(1);
  });

  it("Pay now calls the same function for that checkout and opens Stripe", async () => {
    m().state.queue.push({ data: myOrders });
    renderAccount();
    const pay = await screen.findByRole("button", { name: "Pay now" });
    m().state.queue.push({ data: { url: STRIPE_URL } });
    fireEvent.click(pay);
    await waitFor(() => expect(h.goTo).toHaveBeenCalledWith(STRIPE_URL));
    expect(m().state.invokes[0]).toMatchObject({
      name: "create-checkout-session",
      body: { checkout_group_id: "g-aaaaaaaa1" },
    });
  });

  it("Pay now on a checkout that can't be paid any more says so", async () => {
    m().state.queue.push({ data: myOrders });
    renderAccount();
    const pay = await screen.findByRole("button", { name: "Pay now" });
    m().state.queue.push({ data: { error: "This checkout has expired" } });
    fireEvent.click(pay);
    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith(
        "This order can no longer be paid. Please place it again from your bag.",
      ),
    );
    expect(h.goTo).not.toHaveBeenCalled();
  });

  it("flag off: no Pay now button", async () => {
    vi.stubEnv("VITE_STRIPE_ENABLED", "false");
    m().state.queue.push({ data: myOrders });
    renderAccount();
    await screen.findByText("Order #aaaaaaaa");
    expect(screen.queryByRole("button", { name: "Pay now" })).toBeNull();
  });
});

describe("seller orders: card orders before payment", () => {
  it("shows Awaiting payment and does not offer shipped/delivered until paid", async () => {
    m().state.queue.push({
      data: [
        order("aaaaaaaa1", {}),
        order("bbbbbbbb2", { status: "processing", payment_status: "paid" }),
        order("eeeeeeee5", { payment_provider: "cod" }),
      ],
    });
    renderRoute(
      (root) => [
        createRoute({
          getParentRoute: () => root,
          path: "/",
          component: () => (
            <OrdersPanel
              stores={[{ id: "store-a", name: "Alpha Home" } as StoreRow]}
              status=""
              query=""
              onFiltersChange={() => {}}
            />
          ),
        }),
      ],
      "/",
    );
    const row = (await screen.findByRole("button", { name: "#aaaaaaaa" })).closest("li")!;
    expect(within(row as HTMLElement).getByText("Awaiting payment")).toBeTruthy();
    const options = within(row as HTMLElement).getAllByRole("option") as HTMLOptionElement[];
    const byValue = (v: string) => options.find((o) => o.value === v)!;
    expect(byValue("shipped").disabled).toBe(true);
    expect(byValue("delivered").disabled).toBe(true);
    expect(byValue("processing").disabled).toBe(false);

    const paidRow = screen.getByRole("button", { name: "#bbbbbbbb" }).closest("li")!;
    expect(within(paidRow as HTMLElement).queryByText("Awaiting payment")).toBeNull();
    const codRow = screen.getByRole("button", { name: "#eeeeeeee" }).closest("li")!;
    const codShipped = (
      within(codRow as HTMLElement).getAllByRole("option") as HTMLOptionElement[]
    ).find((o) => o.value === "shipped")!;
    expect(codShipped.disabled).toBe(false);
  });
});
