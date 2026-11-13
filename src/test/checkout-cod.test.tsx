import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
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
const h = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/components/marketplace/cart-context", () => ({
  useCart: () => ({
    items: [
      { productId: "p1", quantity: 1 },
      { productId: "p2", quantity: 1 },
    ],
    ready: true,
    clear: vi.fn(),
    add: vi.fn(),
    setQuantity: vi.fn(),
  }),
}));

import { codRule } from "@/services/checkout";
import { Route as CheckoutRoute } from "@/routes/checkout";
import type { Catalog } from "@/data/catalog";
import type { Locale } from "@/i18n/locales";

const m = () => mock.current!;
beforeEach(() => {
  m().reset();
  h.toast.error.mockClear();
});

const catalog: Catalog = {
  products: [
    {
      id: "p1",
      title: "Lamp",
      price: 20,
      rating: 0,
      reviews: 0,
      storeSlug: "alpha",
      category: "",
      image: "x",
      stock: 5,
      description: "",
    },
    {
      id: "p2",
      title: "Vase",
      price: 15,
      rating: 0,
      reviews: 0,
      storeSlug: "beta",
      category: "",
      image: "x",
      stock: 5,
      description: "",
    },
  ],
  stores: [
    {
      id: "store-a",
      slug: "alpha",
      name: "Alpha Home",
      initials: "ah",
      description: "",
      rating: 0,
      specialty: "",
      image: "",
      logo: null,
      banner: null,
      tone: "sage",
    },
    {
      id: "store-b",
      slug: "beta",
      name: "Beta Decor",
      initials: "bd",
      description: "",
      rating: 0,
      specialty: "",
      image: "",
      logo: null,
      banner: null,
      tone: "rose",
    },
  ],
  categories: [],
};

function renderCheckout(locale: Locale = "en") {
  const qc = testQueryClient();
  qc.setQueryData(["catalog"], catalog);
  const root = createRootRoute();
  const checkout = createRoute({
    getParentRoute: () => root,
    path: "/checkout",
    beforeLoad: () => ({ user: { id: "user-1", email: "s@x.io", user_metadata: {} } }),
    component: CheckoutRoute.options.component!,
  });
  const router = createRouter({
    routeTree: root.addChildren([checkout]),
    history: createMemoryHistory({ initialEntries: ["/checkout"] }),
  });
  return render(
    <WithLocale locale={locale}>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </WithLocale>,
  );
}

describe("codRule", () => {
  it("COD only when no store in the cart is paused; without online payment the order can't be placed", () => {
    expect(codRule([], false)).toEqual({ codAllowed: true, canPlace: true });
    expect(codRule(["s1"], false)).toEqual({ codAllowed: false, canPlace: false });
    expect(codRule(["s1"], true)).toEqual({ codAllowed: false, canPlace: true });
  });
});

describe("checkout with a COD-paused store", () => {
  it("asks store_accepts_cod for each store in the bag", async () => {
    m().state.queue.push({ data: true }, { data: true });
    renderCheckout();
    await screen.findByRole("button", { name: /place order/i });
    await waitFor(() =>
      expect(m().state.rpcs.map((r) => r.args)).toEqual([
        { p_store_id: "store-a" },
        { p_store_id: "store-b" },
      ]),
    );
    expect(screen.getByRole("radio", { name: /pay on delivery/i })).not.toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("disables pay-on-delivery, names the store, and says the order can't be placed (no online payment yet)", async () => {
    m().state.queue.push({ data: true }, { data: false });
    renderCheckout();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Online payment isn't available yet, so this order can't be placed right now. Remove the products from Beta Decor to order the rest.",
    );
    expect(screen.getByRole("radio", { name: /pay on delivery/i })).toBeDisabled();
    expect(
      screen.getByText("Cash on delivery is paused for: Beta Decor. Please pay online."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /place order/i })).toBeDisabled();
  });

  it("in another language too", async () => {
    m().state.queue.push({ data: false }, { data: true });
    renderCheckout("de");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Entferne die Produkte von Alpha Home",
    );
  });

  it("a failing check never blocks by itself (the database still refuses at order time)", async () => {
    m().state.queue.push(
      { error: { code: "PGRST202", message: "missing" } },
      { error: { code: "PGRST202", message: "missing" } },
    );
    renderCheckout();
    const place = await screen.findByRole("button", { name: /place order/i });
    await waitFor(() => expect(m().state.rpcs).toHaveLength(2));
    expect(place).not.toBeDisabled();
  });

  it("the database's COD refusal at order time becomes a plain message", async () => {
    m().state.queue.push({ data: true }, { data: true });
    renderCheckout();
    await waitFor(() => expect(m().state.rpcs).toHaveLength(2));
    for (const [label, value] of [
      [/full name/i, "Sara Ahmadi"],
      [/phone/i, "+93 70 123 4567"],
      [/country/i, "Afghanistan"],
      [/city/i, "Kabul"],
      [/address/i, "Street 1, House 2"],
    ] as const)
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    m().state.session = { user: { id: "user-1" } };
    m().state.queue.push(
      {
        error: {
          code: "P0001",
          message: "This store is not accepting cash on delivery orders right now",
        },
      },
      { data: false },
      { data: true },
    );
    fireEvent.click(screen.getByRole("button", { name: /place order/i }));
    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith(
        "A store in your bag isn't accepting cash on delivery right now. Your order was not placed.",
      ),
    );
  });
});
