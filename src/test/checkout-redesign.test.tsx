import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
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
  goTo: vi.fn(),
  paused: [] as string[],
}));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/components/marketplace/cart-context", () => ({
  useCart: () => ({
    items: [
      { productId: "p1", quantity: 2 },
      { productId: "p2", quantity: 1 },
    ],
    ready: true,
    clear: vi.fn(),
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
import { routeTree } from "@/routeTree.gen";
import { PaymentOverlay } from "@/components/checkout/payment-overlay";
import { usePaymentOverlay } from "@/components/checkout/use-payment-overlay";
import {
  CLOSED_OVERLAY,
  overlaySteps,
  PAYMENT_OVERLAY,
  remainingWait,
} from "@/lib/payment-overlay";
import { countryCodeForName } from "@/lib/iso-countries";
import { checkoutService, type PlaceOrderResult } from "@/services/checkout";
import { cardPaymentService } from "@/services/card-payment";
import { cartTotal } from "@/services/cart";
import { legalDocument } from "@/services/legal";
import { footerQuery, EMPTY_FOOTER } from "@/services/site";
import type { Catalog } from "@/data/catalog";

const m = () => mock.current!;
const STRIPE_URL = "https://checkout.stripe.com/c/pay/cs_test_a1";
beforeEach(() => {
  m().reset();
  window.sessionStorage.clear();
  h.toast.error.mockClear();
  h.goTo.mockClear();
  h.paused = [];
  vi.stubEnv("VITE_STRIPE_ENABLED", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const product = (id: string, storeSlug: string, price: number, title: string) => ({
  id,
  title,
  price,
  rating: 0,
  reviews: 0,
  storeSlug,
  category: "",
  image: `/img/${id}.jpg`,
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
  products: [product("p1", "alpha", 20, "Lamp"), product("p2", "beta", 15.5, "Vase")],
  stores: [store("store-a", "alpha", "Alpha Home"), store("store-b", "beta", "Beta Decor")],
  categories: [],
};
const user = { id: "user-1", email: "s@x.io", user_metadata: {} };

function renderCheckout(qc = testQueryClient()) {
  qc.setQueryData(["catalog"], catalog);
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: "/checkout",
    beforeLoad: () => ({ user }),
    component: CheckoutRoute.options.component!,
  });
  const cart = createRoute({
    getParentRoute: () => root,
    path: "/cart",
    component: () => <h1>Bag</h1>,
  });
  const router = createRouter({
    routeTree: root.addChildren([page, cart]),
    history: createMemoryHistory({ initialEntries: ["/checkout"] }),
  });
  render(
    <WithLocale>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </WithLocale>,
  );
  return { qc };
}

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
const placed: PlaceOrderResult = {
  checkout_group_id: "g-1",
  total: 55.5,
  discount_total: 0,
  currency: "USD",
  payment_provider: "stripe",
  orders: [{ id: "o-1", store_id: "store-a", total: 55.5, discount: 0 }],
};
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// The timing rules
// ---------------------------------------------------------------------------
describe("secure screen: timing", () => {
  it("at least 3 seconds from the click, nothing more", () => {
    expect(PAYMENT_OVERLAY.minMs).toBe(3000);
    expect(remainingWait(1000, 1000)).toBe(3000);
    expect(remainingWait(1000, 2500)).toBe(1500);
    expect(remainingWait(1000, 4000)).toBe(0);
    expect(remainingWait(1000, 9000)).toBe(0);
  });

  it("steps: placing also reserves (one call); Stripe is its own", () => {
    const s = (done: ("placed" | "connected")[], variant: "checkout" | "retry" = "checkout") =>
      overlaySteps({ ...CLOSED_OVERLAY, open: true, variant, done }).map((x) => [x.id, x.done]);
    expect(s([])).toEqual([
      ["place", false],
      ["reserve", false],
      ["connect", false],
    ]);
    expect(s(["placed"])).toEqual([
      ["place", true],
      ["reserve", true],
      ["connect", false],
    ]);
    expect(s(["placed", "connected"])).toEqual([
      ["place", true],
      ["reserve", true],
      ["connect", true],
    ]);
    expect(s([], "retry")).toEqual([["connect", false]]);
  });

  it("redirects at the 3-second mark when the calls were quick", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePaymentOverlay());
    act(() => void result.current.start("checkout"));
    act(() => void vi.advanceTimersByTime(800));
    act(() => void result.current.redirect(STRIPE_URL));
    act(() => void vi.advanceTimersByTime(2199));
    expect(h.goTo).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(h.goTo).toHaveBeenCalledWith(STRIPE_URL);
  });

  it("never longer than the calls when they took more than 3 seconds", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePaymentOverlay());
    act(() => void result.current.start("checkout"));
    act(() => void vi.advanceTimersByTime(4500));
    act(() => void result.current.redirect(STRIPE_URL));
    expect(h.goTo).toHaveBeenCalledWith(STRIPE_URL); // at once
  });

  it("an error closes at once; a second start while open is refused", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => usePaymentOverlay());
    let first = false;
    let second = true;
    act(() => {
      first = result.current.start("checkout");
      second = result.current.start("checkout");
    });
    expect([first, second]).toEqual([true, false]);
    act(() => result.current.close());
    expect(result.current.state.open).toBe(false); // no timer needed
    expect(vi.getTimerCount()).toBe(0);
  });

  it("back from Stripe (page restored from cache): resets, and the page can react", () => {
    const restored = vi.fn();
    const { result } = renderHook(() => usePaymentOverlay({ onPageRestore: restored }));
    act(() => void result.current.start("retry"));
    act(
      () => void window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: false })),
    );
    expect(result.current.state.open).toBe(true); // a normal load is not a restore
    act(() => void window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true })));
    expect(result.current.state.open).toBe(false);
    expect(restored).toHaveBeenCalledTimes(1);
    let again = false;
    act(() => {
      again = result.current.start("retry");
    });
    expect(again).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The screen itself
// ---------------------------------------------------------------------------
describe("secure screen: what it shows", () => {
  const wrap = (ui: ReactNode, qc = new QueryClient()) => (
    <WithLocale>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </WithLocale>
  );

  it("a modal dialog with the logo, real steps and polite announcements; the page behind is inert", () => {
    const behind = document.createElement("div");
    behind.textContent = "page";
    document.body.appendChild(behind);
    const state = {
      open: true,
      variant: "checkout" as const,
      startedAt: 0,
      done: [] as ("placed" | "connected")[],
    };
    const { rerender, unmount } = render(wrap(<PaymentOverlay state={state} />));
    const dialog = screen.getByRole("dialog", { name: "Securing your order…" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(dialog);
    expect(within(dialog).getByRole("img", { name: /saloree/i })).toBeTruthy();
    expect(dialog.textContent).toContain(
      "You will be redirected to our secure payment partner, Stripe. Please do not close this page.",
    );
    // The truthful wording the footer already uses.
    expect(dialog.textContent).toContain(
      "Card payments are processed securely by Stripe. We never see or store your card details.",
    );
    expect(behind.hasAttribute("inert")).toBe(true);
    expect(behind.getAttribute("aria-hidden")).toBe("true");
    expect(document.body.style.overflow).toBe("hidden");
    const live = screen.getByTestId("payment-overlay-live");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toBe("Placing your order…");
    rerender(wrap(<PaymentOverlay state={{ ...state, done: ["placed"] }} />));
    expect(screen.getByTestId("payment-overlay-live").textContent).toBe(
      "Your order is placed and your items are reserved. Connecting to Stripe…",
    );
    const items = screen.getAllByRole("listitem");
    expect(items.map((i) => i.hasAttribute("data-done"))).toEqual([true, true, false]);
    unmount();
    expect(behind.hasAttribute("inert")).toBe(false); // restored
    expect(behind.hasAttribute("aria-hidden")).toBe(false);
    behind.remove();
  });

  it("the shorter text for Pay now / Try payment again", () => {
    render(
      wrap(<PaymentOverlay state={{ open: true, variant: "retry", startedAt: 0, done: [] }} />),
    );
    expect(screen.getByRole("dialog", { name: "Opening the payment page…" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("company line only when its details are filled (from the footer's cache, no request)", () => {
    const qc = new QueryClient();
    qc.setQueryData(footerQuery.queryKey, {
      ...EMPTY_FOOTER,
      company: {
        legalName: "Siirtamo OY",
        businessId: "3640470-1",
        address: null,
        supportEmail: null,
      },
    });
    render(
      wrap(<PaymentOverlay state={{ open: true, variant: "retry", startedAt: 0, done: [] }} />, qc),
    );
    expect(screen.getByRole("dialog").textContent).toContain("Siirtamo OY · 3640470-1");
    expect(m().state.queries).toHaveLength(0);
  });

  it("reduced motion: no animation", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) => ({ matches: q.includes("reduce"), media: q }) as MediaQueryList,
    );
    render(
      wrap(<PaymentOverlay state={{ open: true, variant: "retry", startedAt: 0, done: [] }} />),
    );
    expect(screen.getByTestId("payment-overlay").hasAttribute("data-reduced-motion")).toBe(true);
    const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toMatch(/\.pay-overlay\[data-reduced-motion\][^{]*\{\s*animation: none;/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.pay-overlay,/);
  });
});

// ---------------------------------------------------------------------------
// On the checkout page
// ---------------------------------------------------------------------------
describe("checkout: the secure screen follows the real calls", () => {
  it("appears in the click, ticks each step as its call returns, then goes to Stripe", async () => {
    const place = deferred<PlaceOrderResult>();
    const start = deferred<string>();
    const placeOrder = vi.spyOn(checkoutService, "placeOrder").mockReturnValue(place.promise);
    vi.spyOn(cardPaymentService, "startPayment").mockReturnValue(start.promise);
    vi.spyOn(cardPaymentService, "groupPayment").mockResolvedValue([
      { id: "o-1", status: "pending", payment_status: "pending", payment_provider: "stripe" },
    ] as never);
    renderCheckout();
    fireEvent.click(await screen.findByRole("radio", { name: /pay by card/i }));
    fillForm();
    const pay = screen.getByRole("button", { name: "Pay $55.50" });
    fireEvent.click(pay);
    fireEvent.click(pay); // a double click
    // Same frame as the click: no waiting for anything.
    const dialog = screen.getByRole("dialog", { name: "Securing your order…" });
    const done = () =>
      within(dialog)
        .getAllByRole("listitem")
        .map((i) => i.hasAttribute("data-done"));
    expect(done()).toEqual([false, false, false]);
    await act(async () => place.resolve(placed));
    await waitFor(() => expect(done()).toEqual([true, true, false]));
    await act(async () => start.resolve(STRIPE_URL));
    await waitFor(() => expect(done()).toEqual([true, true, true]));
    expect(placeOrder).toHaveBeenCalledTimes(1); // never two orders
    await waitFor(() => expect(h.goTo).toHaveBeenCalledWith(STRIPE_URL), { timeout: 4000 });
  });

  it("an error: closes at once (no minimum), back to the form with the real text", async () => {
    vi.spyOn(checkoutService, "placeOrder").mockResolvedValue(placed);
    vi.spyOn(cardPaymentService, "startPayment").mockRejectedValue(
      new Error("Stripe is not configured on the server"),
    );
    vi.spyOn(cardPaymentService, "groupPayment").mockResolvedValue([
      { id: "o-1", status: "pending", payment_status: "pending", payment_provider: "stripe" },
    ] as never);
    renderCheckout();
    fireEvent.click(await screen.findByRole("radio", { name: /pay by card/i }));
    fillForm();
    const t0 = Date.now();
    fireEvent.click(screen.getByRole("button", { name: "Pay $55.50" }));
    expect(screen.getByTestId("payment-overlay")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("payment-overlay")).toBeNull());
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(h.toast.error).toHaveBeenCalledWith("Stripe is not configured on the server");
    expect(h.goTo).not.toHaveBeenCalled();
    // The existing safety net: the same checkout is offered again, no new order.
    expect(await screen.findByRole("button", { name: /try payment again/i })).toBeTruthy();
  });

  it("cash orders don't show the screen", async () => {
    vi.stubEnv("VITE_STRIPE_ENABLED", "false");
    vi.spyOn(checkoutService, "placeOrder").mockReturnValue(new Promise(() => {}));
    renderCheckout();
    await screen.findByRole("radio", { name: /pay on delivery/i });
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Place order" }));
    expect(screen.queryByTestId("payment-overlay")).toBeNull();
  });
});

describe("checkout: the form", () => {
  it("labels with autocomplete, and the country as a searchable ISO list", async () => {
    renderCheckout();
    const name = await screen.findByLabelText(/full name/i);
    expect(name.getAttribute("autocomplete")).toBe("name");
    expect(screen.getByLabelText(/phone/i).getAttribute("autocomplete")).toBe("tel");
    expect(screen.getByLabelText(/email/i).getAttribute("autocomplete")).toBe("email");
    expect(screen.getByLabelText(/city/i).getAttribute("autocomplete")).toBe("address-level2");
    expect(screen.getByLabelText(/street address/i).getAttribute("autocomplete")).toBe(
      "street-address",
    );
    const country = screen.getByRole("combobox", { name: /country/i });
    expect(country.getAttribute("autocomplete")).toBe("country-name");
    expect(screen.getByText("Include your country code, for example +93.")).toBeTruthy();
    fireEvent.focus(country);
    fireEvent.change(country, { target: { value: "finl" } });
    const list = screen.getByRole("listbox");
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Finland"]);
    fireEvent.keyDown(country, { key: "Enter" });
    expect((country as HTMLInputElement).value).toBe("Finland");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(countryCodeForName("finland")).toBe("FI");
    expect(countryCodeForName("Narnia")).toBeNull();
  });

  it("a made-up country is refused with a clear message; blur checks a field without repeating it", async () => {
    renderCheckout();
    await screen.findByLabelText(/full name/i);
    fillForm();
    fireEvent.change(screen.getByLabelText(/country/i), { target: { value: "Narnia" } });
    const phone = screen.getByLabelText(/phone/i);
    fireEvent.change(phone, { target: { value: "12ab" } });
    fireEvent.blur(phone);
    const phoneError = await screen.findByText("Enter a valid phone number.");
    expect(phoneError.textContent).not.toContain("12ab");
    fireEvent.change(phone, { target: { value: "+93 70 123 4567" } });
    expect(screen.queryByText("Enter a valid phone number.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /pay \$|place order/i }));
    expect(await screen.findByText("Choose your country from the list.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(/country/i));
  });

  it("the place-order call gets the country by name, as before", async () => {
    const placeOrder = vi
      .spyOn(checkoutService, "placeOrder")
      .mockReturnValue(new Promise(() => {}));
    vi.stubEnv("VITE_STRIPE_ENABLED", "false");
    renderCheckout();
    await screen.findByRole("radio", { name: /pay on delivery/i });
    fillForm();
    fireEvent.click(screen.getByRole("button", { name: "Place order" }));
    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(1));
    expect(placeOrder.mock.calls[0]![1]).toMatchObject({ country: "Afghanistan" });
  });

  it("payment methods: a radio group of what is really offered", async () => {
    renderCheckout();
    const group = (await screen.findByRole("radio", { name: /pay by card/i })).closest("fieldset")!;
    expect(
      within(group)
        .getAllByRole("radio")
        .map((r) => (r as HTMLInputElement).value),
    ).toEqual(["cod", "stripe"]);
    expect(within(group).getByText("You will pay on Stripe's secure page.")).toBeTruthy();
    expect(within(group).getByText("Pay in cash when your order arrives.")).toBeTruthy();
    expect(within(group).queryByText(/HesabPay|coming soon/i)).toBeNull();
    expect(within(group).getAllByTestId("card-brand")).toHaveLength(6);
    fireEvent.click(screen.getByRole("radio", { name: /pay by card/i }));
    expect(screen.getByTestId("method-stripe").className).toContain("selected");
  });

  it("the button: 'Pay <total>' for card, 'Place order' for cash; looks unavailable until complete", async () => {
    renderCheckout();
    const cash = await screen.findByRole("button", { name: "Place order" });
    expect(cash.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("Fill in your delivery details to continue.")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: /pay by card/i }));
    expect(screen.getByRole("button", { name: "Pay $55.50" })).toBeTruthy();
    fillForm();
    expect(screen.getByRole("button", { name: "Pay $55.50" }).hasAttribute("aria-disabled")).toBe(
      false,
    );
    expect(
      within(screen.getByRole("navigation", { name: "Checkout steps" }))
        .getByText("Payment")
        .getAttribute("aria-current"),
    ).toBe("step");
    // A discount code changes the total: no amount promised then.
    fireEvent.change(screen.getByLabelText("Discount code"), { target: { value: "save10" } });
    expect(screen.getByRole("button", { name: "Continue to payment" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(screen.getByText("SAVE10 will be checked when you place your order.")).toBeTruthy();
  });

  it("totals are exactly the existing calculation", async () => {
    renderCheckout();
    const expected = new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(
      cartTotal(
        [
          { productId: "p1", quantity: 2 },
          { productId: "p2", quantity: 1 },
        ],
        catalog.products,
      ),
    );
    expect(expected).toBe("$55.50");
    expect((await screen.findByTestId("checkout-total")).textContent).toBe(expected);
    expect(screen.getByText("Estimated total")).toBeTruthy();
    expect(
      screen.getByText(
        "Prices, stock and shipping are confirmed by Saloree when you place the order. Items from different stores become separate orders.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Items from Alpha Home and Beta Decor become separate orders, one per store.",
      ),
    ).toBeTruthy();
  });

  it("phones: the summary folds, with the total on its toggle", async () => {
    renderCheckout();
    const toggle = await screen.findByRole("button", { name: /show order summary/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("$55.50");
    const body = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    expect(body.hasAttribute("data-collapsed")).toBe(true);
    fireEvent.click(toggle);
    expect(
      screen.getByRole("button", { name: /hide order summary/i }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(body.hasAttribute("data-collapsed")).toBe(false);
    const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toMatch(/\.checkout-summary-body\[data-collapsed\]\s*\{\s*display: none;/);
    expect(css).toMatch(/\.checkout-pay \{\s*position: fixed;/);
  });

  it("trust row: only true claims, and the policy links resolve", async () => {
    renderCheckout();
    const trust = await screen.findByRole("list", { name: "Secure checkout" });
    expect(trust.textContent).toContain("Secure payment with Stripe");
    expect(trust.textContent).toContain("Cash on delivery available");
    const links = within(trust).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/legal/terms",
      "/legal/privacy",
      "/legal/returns",
      "/legal/shipping",
    ]);
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    for (const a of links) {
      const href = a.getAttribute("href")!;
      expect(router.matchRoutes(href).at(-1)?.routeId, href).toBe("/legal/$slug");
      expect(legalDocument(href.replace("/legal/", "")), href).toBeTruthy();
    }
  });

  it("with cash paused for a store: no 'Cash on delivery available' claim", async () => {
    h.paused = ["store-b"];
    renderCheckout();
    await screen.findByRole("radio", { name: /pay by card/i });
    await waitFor(() => expect(screen.queryByText("Cash on delivery available")).toBeNull());
  });
});
