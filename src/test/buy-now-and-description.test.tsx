import { readFileSync } from "node:fs";
import { LOCALES } from "@/i18n/locales";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useRouterState,
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
  add: vi.fn(),
  clear: vi.fn(),
  goTo: vi.fn(),
  bag: [{ productId: "p1", quantity: 1 }],
}));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/components/marketplace/cart-context", () => ({
  useCart: () => ({ items: h.bag, ready: true, clear: h.clear, add: h.add, setQuantity: vi.fn() }),
}));
vi.mock("@/services/payouts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/payouts")>()),
  codPausedStores: async () => [],
}));
vi.mock("@/lib/pending-payment", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/pending-payment")>()),
  goToPaymentPage: h.goTo,
}));
vi.mock("@/hooks/use-wishlist", () => ({
  useWishlist: () => ({ has: () => false, toggle: vi.fn(), pending: false }),
  useWishlistCount: () => 0,
  useIsWishlisted: () => false,
}));
vi.mock("@/components/marketplace/wishlist-button", () => ({
  WishlistButton: () => <button type="button">Wishlist</button>,
}));

import { Route as ProductRoute } from "@/routes/product.$id";
import { Route as CheckoutRoute } from "@/routes/checkout";
import { ProductDescription } from "@/components/marketplace/product-description";
import { buyNowQuantity, parseBuyNowSearch } from "@/lib/buy-now";
import {
  descriptionBlocks,
  descriptionText,
  isLongDescription,
  normalizeDescription,
} from "@/lib/rich-text";
import { readPendingPayment } from "@/lib/pending-payment";
import { checkoutService, type PlaceOrderResult } from "@/services/checkout";
import { cardPaymentService } from "@/services/card-payment";
import { cartTotal } from "@/services/cart";
import type { Catalog, Product } from "@/data/catalog";

const m = () => mock.current!;
beforeEach(() => {
  m().reset();
  window.sessionStorage.clear();
  h.add.mockClear();
  h.clear.mockClear();
  h.goTo.mockClear();
  h.toast.error.mockClear();
  h.bag = [{ productId: "p1", quantity: 1 }];
  vi.stubEnv("VITE_STRIPE_ENABLED", "true");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** The real description of the BYTECORE NFC card, as stored. */
const REAL = `# Waterproof Genuine Leather Product – Premium Quality & Design

Discover the perfect combination of quality, durability, and practical design. This premium waterproof genuine leather product is designed for customers who value reliable materials, elegant appearance, and everyday convenience.

Featuring a waterproof design and multiple language options, it offers versatility for different customer preferences and markets.

### Key Features
- **Genuine Leather:** Premium leather material with an elegant finish.
- **Waterproof Design:** Designed to offer protection against water exposure.
- **Multiple Language Options:** Available in different language variations.
- **Ready to Ship:** In-stock availability for convenient ordering.
- **Premium Appearance:** Stylish design suitable for everyday use.
- **Versatile Use:** A practical choice for different customer needs.

### Why Choose This Product?
- Quality-focused construction
- Practical and stylish design
- Suitable for different markets
- Convenient in-stock availability

**BYTECORE – Technology. Accessories. More.**

Upgrade your everyday essentials with BYTECORE.`;
/** The same text on one line, as it appeared on the page. */
const ONE_LINE = REAL.replace(/\s*\n\s*/g, " ");

// ---------------------------------------------------------------------------
// Descriptions
// ---------------------------------------------------------------------------
describe("description: safe formatted text", () => {
  it("renders the real description as headings, bold and lists (no Markdown symbols left)", () => {
    render(<ProductDescription text={REAL} />);
    const body = screen.getByTestId("product-description");
    expect(within(body).getByRole("heading", { level: 2 }).textContent).toBe(
      "Waterproof Genuine Leather Product – Premium Quality & Design",
    );
    expect(
      within(body)
        .getAllByRole("heading", { level: 3 })
        .map((x) => x.textContent),
    ).toEqual(["Key Features", "Why Choose This Product?"]);
    const lists = within(body).getAllByRole("list");
    expect(lists.map((l) => within(l).getAllByRole("listitem").length)).toEqual([6, 4]);
    expect(
      within(lists[0]!).getAllByRole("listitem")[0]!.querySelector("strong")?.textContent,
    ).toBe("Genuine Leather:");
    expect(body.textContent).not.toMatch(/(^|\s)#{1,6}\s|\*\*/);
    expect(body.querySelector("h2")?.id).toBe(""); // no ids from seller text
  });

  it("one-line text: breaks before headings and list items, keeping hyphens in words and numbers", () => {
    const n = normalizeDescription(ONE_LINE);
    expect(n).toContain("\n\n### Key Features\n- **Genuine Leather:**");
    expect(n).toContain("\n- **Versatile Use:**");
    expect(n).toContain("\n\n### Why Choose This Product?\n- Quality-focused construction");
    expect(n).toContain("In-stock availability"); // a hyphen inside a word stays
    const blocks = descriptionBlocks(ONE_LINE);
    expect(blocks.filter((b) => b.t === "h").map((b) => b.t === "h" && b.text)).toEqual([
      "Key Features",
      "Why Choose This Product?",
    ]);
    const lists = blocks.filter((b): b is Extract<typeof b, { t: "list" }> => b.t === "list");
    expect(lists.map((l) => l.items.length)).toEqual([6, 4]);
    // A title run together with its paragraph can't be split safely: shown as text, without "#".
    expect(blocks[0]).toMatchObject({ t: "p" });
    expect(JSON.stringify(blocks[0])).not.toContain("# ");
    for (const keep of [
      "Genuine 215chip NFC Tap to Review",
      "Delivery in 2-3 days",
      "Save - 5% today",
      "A well-known brand",
    ])
      expect(normalizeDescription(keep), keep).toBe(keep);
    expect(normalizeDescription(REAL)).toBe(REAL); // text with line breaks is shown as written
  });

  it("HTML and scripts are plain text; links are safe and open in a new tab", () => {
    const evil =
      "<script>alert(1)</script> <img src=x onerror=alert(1)> [click](javascript:alert(1)) [site](https://example.com) [[COMPANY_NAME]]";
    const { container } = render(<ProductDescription text={evil} />);
    expect(container.querySelector("script, img, iframe")).toBeNull();
    const body = screen.getByTestId("product-description");
    expect(body.textContent).toContain("<script>alert(1)</script>");
    expect(body.textContent).toContain("[[COMPANY_NAME]]");
    expect(within(body).queryByRole("link", { name: "click" })).toBeNull();
    const link = within(body).getByRole("link", { name: "site" });
    expect(link.getAttribute("href")).toBe("https://example.com");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });

  it("long descriptions fold to about 8 lines with Show more / Show less", () => {
    expect(isLongDescription(REAL)).toBe(true);
    render(<ProductDescription text={REAL} />);
    const body = screen.getByTestId("product-description");
    const more = screen.getByRole("button", { name: "Show more" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(more.getAttribute("aria-controls")).toBe(body.id);
    expect(body.hasAttribute("data-collapsed")).toBe(true);
    fireEvent.click(more);
    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(body.hasAttribute("data-collapsed")).toBe(false);
  });

  it("short descriptions have no toggle; an empty one shows nothing", () => {
    const { container, rerender } = render(<ProductDescription text="A small vase." />);
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<ProductDescription text="   " />);
    expect(container.textContent).toBe("");
  });

  it("plain text for meta tags and snippets: no '#', '**' or list dashes", () => {
    const meta = descriptionText(REAL);
    expect(meta).not.toMatch(/#|\*\*|(^|\s)- /);
    expect(
      meta.startsWith("Waterproof Genuine Leather Product – Premium Quality & Design. Discover"),
    ).toBe(true);
    expect(meta.length).toBeLessThanOrEqual(160);
    expect(meta.endsWith("…")).toBe(true);
    expect(descriptionText(ONE_LINE)).not.toMatch(/#|\*\*/);
    expect(descriptionText(null)).toBe("");
  });

  it("the product page's meta description is plain text", () => {
    const head = ProductRoute.options.head as unknown as (ctx: {
      loaderData: Product;
      matches: never[];
    }) => { meta: { name?: string; property?: string; content?: string }[] };
    const meta = head({ loaderData: product("p1", 5, REAL), matches: [] }).meta;
    for (const key of ["description", "og:description"]) {
      const content = meta.find((x) => x.name === key || x.property === key)?.content ?? "";
      expect(content, key).toContain("Waterproof Genuine Leather Product");
      expect(content, key).not.toMatch(/#|\*\*/);
    }
  });
});

// ---------------------------------------------------------------------------
// Buy now
// ---------------------------------------------------------------------------
function product(id: string, stock: number, description = "A lamp."): Product {
  return {
    id,
    title: id === "p1" ? "Lamp" : "Vase",
    price: id === "p1" ? 20 : 15.5,
    rating: 0,
    reviews: 0,
    storeSlug: "alpha",
    category: "decor",
    image: "/x.jpg",
    stock,
    description,
  } as Product;
}
const catalog = (p2Stock = 5): Catalog => ({
  products: [product("p1", 5), product("p2", p2Stock)],
  stores: [
    {
      id: "store-a",
      slug: "alpha",
      name: "Alpha Home",
      initials: "AH",
      description: "",
      rating: 0,
      specialty: "",
      image: "",
      tone: "sage",
    },
  ],
  categories: [],
});

function Where() {
  const href = useRouterState({ select: (s) => s.location.href });
  return <p data-testid="where">{href}</p>;
}

/** The real product page and checkout components in a small router. */
function renderApp(path: string, cat = catalog()) {
  const qc = testQueryClient();
  qc.setQueryData(["catalog"], cat);
  const user = { id: "user-1", email: "s@x.io", user_metadata: {} };
  const root = createRootRoute({
    component: () => (
      <>
        <Outlet />
        <Where />
      </>
    ),
  });
  const productPage = createRoute({
    getParentRoute: () => root,
    path: "/product/$id",
    loader: ({ params }) => cat.products.find((p) => p.id === params.id)!,
    component: ProductRoute.options.component!,
  });
  const checkout = createRoute({
    getParentRoute: () => root,
    path: "/checkout",
    validateSearch: CheckoutRoute.options.validateSearch!,
    beforeLoad: () => ({ user }),
    component: CheckoutRoute.options.component!,
  });
  const cart = createRoute({
    getParentRoute: () => root,
    path: "/cart",
    component: () => <h1>Bag</h1>,
  });
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createRouter({
    routeTree: root.addChildren([productPage, checkout, cart]),
    history,
  });
  render(
    <WithLocale>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </WithLocale>,
  );
  return { router, history };
}

describe("Buy now: rules", () => {
  it("reads only an id and a whole quantity from the address", () => {
    expect(parseBuyNowSearch({ buy: "6f1c2b0a-4d3e", qty: "3" })).toEqual({
      buy: "6f1c2b0a-4d3e",
      qty: 3,
    });
    expect(parseBuyNowSearch({ buy: "<script>", qty: "x", email: "a@b.c" })).toEqual({});
    expect(parseBuyNowSearch({ buy: "p1", qty: 2.7 })).toEqual({ buy: "p1", qty: 2 });
  });
  it("quantity: 1 to what is in stock", () => {
    expect(buyNowQuantity(3, 5)).toBe(3);
    expect(buyNowQuantity(99, 5)).toBe(5);
    expect(buyNowQuantity(0, 5)).toBe(1);
    expect(buyNowQuantity(-2, 5)).toBe(1);
    expect(buyNowQuantity(undefined, 5)).toBe(1);
    expect(buyNowQuantity(2, 0)).toBe(0);
  });
});

describe("Buy now: on the product page", () => {
  it("next to Add to cart (outlined), goes to a checkout of this product only; the bag is not touched", async () => {
    const { history } = renderApp("/product/p1");
    const add = await screen.findByRole("button", { name: /add to cart/i });
    const buy = screen.getByRole("button", { name: /buy now/i });
    expect(add.className).toMatch(/border/); // the outlined (secondary) style
    expect(buy.className).not.toMatch(/border-input/);
    expect(add.compareDocumentPosition(buy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Increase quantity" }));
    fireEvent.click(buy);
    fireEvent.click(buy); // a double click navigates once
    await waitFor(() =>
      expect(screen.getByTestId("where").textContent).toBe("/checkout?buy=p1&qty=2"),
    );
    expect(history.length).toBe(2);
    expect(h.add).not.toHaveBeenCalled();
  });

  it("out of stock: both buttons disabled, with the stock text as the reason", async () => {
    renderApp("/product/p2", catalog(0));
    const buy = await screen.findByRole("button", { name: /buy now/i });
    expect(buy).toBeDisabled();
    expect(screen.getByRole("button", { name: /add to cart/i })).toBeDisabled();
    expect(document.getElementById(buy.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Out of stock",
    );
  });

  it("shows the description formatted", async () => {
    renderApp("/product/p1", {
      ...catalog(),
      products: [product("p1", 5, REAL), product("p2", 5)],
    });
    expect(await screen.findByRole("heading", { level: 3, name: "Key Features" })).toBeTruthy();
  });
});

describe("Buy now: the checkout", () => {
  const placed: PlaceOrderResult = {
    checkout_group_id: "g-9",
    total: 77.5,
    discount_total: 0,
    currency: "USD",
    payment_provider: "cod",
    orders: [{ id: "o-9", store_id: "store-a", total: 77.5, discount: 0 }],
  };
  const fill = () => {
    for (const [label, value] of [
      [/full name/i, "Sara Ahmadi"],
      [/phone/i, "+93 70 123 4567"],
      [/country/i, "Afghanistan"],
      [/city/i, "Kabul"],
      [/address/i, "Street 1, House 2"],
    ] as const)
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
  };

  it("only this item and quantity (not the bag), its total, and Back to product", async () => {
    renderApp("/checkout?buy=p2&qty=5");
    const total = await screen.findByTestId("checkout-total");
    const expected = new Intl.NumberFormat("en", { style: "currency", currency: "USD" }).format(
      cartTotal([{ productId: "p2", quantity: 5 }], catalog().products),
    );
    expect(total.textContent).toBe(expected);
    expect(expected).toBe("$77.50");
    const items = document.querySelectorAll(".checkout-items li");
    expect(items).toHaveLength(1);
    expect(items[0]!.textContent).toContain("5 × Vase");
    expect(screen.queryByText(/Lamp/)).toBeNull(); // the bag's item is not here
    const back = within(screen.getByRole("navigation", { name: "Checkout steps" })).getByRole(
      "link",
    );
    expect(back.textContent).toBe("Back to product");
    expect(back.getAttribute("href")).toBe("/product/p2");
    expect(screen.getByText("You're buying only this item. Your bag stays as it is.")).toBeTruthy();
  });

  it("the quantity is capped to the stock", async () => {
    renderApp("/checkout?buy=p2&qty=99", catalog(3));
    expect((await screen.findAllByText(/3 × Vase/)).length).toBeGreaterThan(0);
  });

  it("a cash order sends only this item and keeps the bag", async () => {
    vi.stubEnv("VITE_STRIPE_ENABLED", "false");
    const placeOrder = vi.spyOn(checkoutService, "placeOrder").mockResolvedValue(placed);
    renderApp("/checkout?buy=p2&qty=2");
    await screen.findByRole("radio", { name: /pay on delivery/i });
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Place order" }));
    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(1));
    expect(placeOrder.mock.calls[0]![0]).toEqual([{ productId: "p2", quantity: 2 }]);
    await waitFor(() =>
      expect(screen.getByTestId("where").textContent).toBe("/order-confirmation/g-9"),
    );
    expect(h.clear).not.toHaveBeenCalled();
  });

  it("a card order remembers it was Buy now, so the return page keeps the bag", async () => {
    vi.spyOn(checkoutService, "placeOrder").mockResolvedValue({
      ...placed,
      payment_provider: "stripe",
    });
    vi.spyOn(cardPaymentService, "startPayment").mockResolvedValue(
      "https://checkout.stripe.com/c/pay/x",
    );
    vi.spyOn(cardPaymentService, "groupPayment").mockResolvedValue([
      { id: "o-9", status: "pending", payment_status: "pending", payment_provider: "stripe" },
    ] as never);
    renderApp("/checkout?buy=p2&qty=1");
    fireEvent.click(await screen.findByRole("radio", { name: /pay by card/i }));
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Pay $15.50" }));
    await waitFor(() =>
      expect(readPendingPayment()).toMatchObject({ groupId: "g-9", express: true }),
    );
    const page = readFileSync(
      join(process.cwd(), "src/routes/order-confirmation.index.tsx"),
      "utf8",
    );
    expect(page).toMatch(
      /started\?\.groupId === groupId && !started\.express\) clearRef\.current\(\)/,
    );
  });

  it("a product that is no longer available: says so, with a way back, bag untouched", async () => {
    renderApp("/checkout?buy=gone&qty=1");
    expect(await screen.findByText("This product is no longer available")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to product" }).getAttribute("href")).toBe(
      "/product/gone",
    );
    expect(h.clear).not.toHaveBeenCalled();
  });

  it("signed out: sign-in first, then back to the same Buy now checkout (ids only)", async () => {
    m().state.session = null;
    const href = "/checkout?buy=p2&qty=2";
    const guard = CheckoutRoute.options.beforeLoad as unknown as (ctx: {
      location: { href: string };
    }) => Promise<unknown>;
    const thrown = await guard({ location: { href } }).catch((e: unknown) => e);
    const options = (thrown as { options?: { to?: string; search?: { redirect?: string } } })
      .options;
    expect(options?.to).toBe("/login");
    expect(options?.search?.redirect).toBe(href);
  });
});

describe("i18n", () => {
  it("the new texts exist in every language", () => {
    const json = (p: string) =>
      JSON.parse(readFileSync(join(process.cwd(), p), "utf8")) as Record<string, unknown>;
    for (const code of LOCALES.map((l) => l.code)) {
      const product = json(`src/locales/${code}/product.json`);
      for (const k of ["buyNow", "showMore", "showLess"])
        expect(product[k], `${code}.${k}`).toBeTruthy();
      const checkout = json(`src/locales/${code}/checkout.json`) as {
        steps: Record<string, string>;
        express: Record<string, string>;
      };
      expect(checkout.steps["backToProduct"], code).toBeTruthy();
      for (const k of ["note", "unavailableTitle", "unavailableText"])
        expect(checkout.express[k], `${code}.express.${k}`).toBeTruthy();
    }
  });
});
