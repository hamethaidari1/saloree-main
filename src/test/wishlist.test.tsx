import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Link } from "@tanstack/react-router";
import { createSupabaseMock } from "./supabase-mock";
import { renderWithRouter } from "./router-harness";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

const h = vi.hoisted(() => ({
  auth: { user: null as null | { id: string }, ready: true },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  cart: { add: vi.fn(), items: [] as { productId: string; quantity: number }[] },
}));
vi.mock("@/lib/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth")>()),
  useAuth: () => ({
    ...h.auth,
    roles: [],
    fullName: null,
    isSeller: false,
    isAdmin: false,
    staffHome: null,
  }),
}));
vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/components/marketplace/cart-context", () => ({
  useCart: () => ({ ...h.cart, ready: true, setQuantity: vi.fn(), clear: vi.fn() }),
}));

import {
  mainSiteSaveSignInUrl,
  NotSignedInError,
  parsePendingSave,
  pendingSaveFromUrl,
  PENDING_MAX_AGE_MS,
  rememberPendingSave,
  takePendingSave,
  toWishlistItems,
  wishlistErrorKind,
  wishlistService,
  withoutSaveParam,
  type WishlistRow,
} from "@/services/wishlist";
import { PendingWishlistSave, WishlistButton } from "@/components/marketplace/wishlist-button";
import { Route as WishlistRoute } from "@/routes/wishlist";
import { isMainOnlyPath } from "@/lib/host";

const m = () => mock.current!;
const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const P3 = "33333333-3333-4333-8333-333333333333";
const signIn = () => {
  h.auth.user = { id: "user-1" };
  m().state.session = { user: { id: "user-1" } };
};
beforeEach(() => {
  m().reset();
  sessionStorage.clear();
  h.auth = { user: null, ready: true };
  m().state.session = null;
  h.toast.success.mockClear();
  h.toast.error.mockClear();
  h.cart.add.mockClear();
  h.cart.items = [];
});

const row = (
  id: string,
  patch: Partial<NonNullable<WishlistRow["products"]>> = {},
  saved = "2026-11-10T10:00:00Z",
): WishlistRow => ({
  product_id: id,
  created_at: saved,
  products: {
    id,
    store_id: "s1",
    category_id: null,
    title: `Lamp ${id.slice(0, 1)}`,
    slug: `lamp-${id.slice(0, 1)}`,
    description: null,
    price: "12.50" as unknown as number,
    compare_price: null,
    stock: 3,
    featured_image: "https://img.example/lamp.jpg",
    status: "active",
    created_at: "2026-11-01T00:00:00Z",
    stores: { slug: "alpha", name: "Alpha Store", status: "published" },
    categories: { slug: "home" },
    product_images: [],
    ...patch,
  },
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
describe("wishlist service", () => {
  it("list: own rows, newest first, with product + store; unavailable ones left out", async () => {
    signIn();
    m().state.queue.push({
      data: [
        row(P1),
        { product_id: P2, created_at: "2026-11-09T00:00:00Z", products: null }, // deleted
        row(P3, { status: "draft" }), // archived / draft
        row("44444444-4444-4444-8444-444444444444", {
          stores: { slug: "gone", name: "Gone", status: "draft" }, // store unpublished
        }),
      ],
    });
    const items = await wishlistService.list();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      productId: P1,
      savedAt: "2026-11-10T10:00:00Z",
      storeName: "Alpha Store",
      product: {
        id: P1,
        price: 12.5,
        stock: 3,
        storeSlug: "alpha",
        image: "https://img.example/lamp.jpg",
      },
    });
    const calls = m().callsOn("wishlist_items");
    expect(String(calls.find((c) => c[0] === "select")?.[1])).toMatch(
      /products\(.*stores\(slug, name, status\)/,
    );
    expect(calls).toContainEqual(["eq", "user_id", "user-1"]);
    expect(calls).toContainEqual(["order", "created_at", { ascending: false }]);
  });

  it("guests have no wishlist: nothing is queried", async () => {
    await expect(wishlistService.list()).rejects.toBeInstanceOf(NotSignedInError);
    await expect(wishlistService.add(P1)).rejects.toBeInstanceOf(NotSignedInError);
    expect(m().state.queries).toHaveLength(0);
  });

  it("add sends ONLY product_id (the database fills user_id); already saved is fine", async () => {
    signIn();
    await wishlistService.add(P1);
    expect(m().callsOn("wishlist_items")[0]).toEqual(["insert", { product_id: P1 }]);
    m().state.queue.push({ error: { code: "23505", message: "duplicate key value" } });
    await expect(wishlistService.add(P1)).resolves.toBeUndefined();
  });

  it("add refuses a bad id before calling the database", async () => {
    signIn();
    await expect(wishlistService.add("not-a-uuid")).rejects.toThrow();
    expect(m().state.queries).toHaveLength(0);
  });

  it("database refusals come through as-is (full, not allowed, table missing)", async () => {
    signIn();
    m().state.queue.push({
      error: { code: "P0001", message: "Your wishlist is full (200 products)" },
    });
    await expect(wishlistService.add(P1)).rejects.toMatchObject({
      message: "Your wishlist is full (200 products)",
    });
    m().state.queue.push({
      error: {
        code: "PGRST205",
        message: "Could not find the table 'public.wishlist_items' in the schema cache",
      },
    });
    await expect(wishlistService.list()).rejects.toMatchObject({ code: "PGRST205" });
  });

  it("remove deletes only this user's row for that product", async () => {
    signIn();
    await wishlistService.remove(P2);
    const calls = m().callsOn("wishlist_items");
    expect(calls).toContainEqual(["delete"]);
    expect(calls).toContainEqual(["eq", "user_id", "user-1"]);
    expect(calls).toContainEqual(["eq", "product_id", P2]);
  });

  it("ids and count", async () => {
    signIn();
    m().state.queue.push({ data: [{ product_id: P1 }, { product_id: P2 }] }, { count: 2 });
    expect(await wishlistService.ids()).toEqual([P1, P2]);
    expect(await wishlistService.count()).toBe(2);
    expect(m().callsOn("wishlist_items", 1)).toContainEqual([
      "select",
      "product_id",
      { count: "exact", head: true },
    ]);
  });

  it.each([
    [new NotSignedInError(), "notSignedIn"],
    [{ code: "P0001", message: "Your wishlist is full (200 products)" }, "full"],
    [
      {
        code: "42501",
        message: 'new row violates row-level security policy for table "wishlist_items"',
      },
      "unavailable",
    ],
    [{ code: "23503", message: "insert or update violates foreign key constraint" }, "unavailable"],
    [{ code: "PGRST205", message: "Could not find the table" }, "notReady"],
    [{ message: "TypeError: Failed to fetch" }, "network"],
    [{ code: "XX000", message: "something odd" }, null],
  ])("%j → %s", (error, kind) => expect(wishlistErrorKind(error)).toBe(kind));

  it("toWishlistItems never throws on odd rows", () => {
    expect(toWishlistItems([{ product_id: P1, created_at: "x", products: null }])).toEqual([]);
    expect(toWishlistItems([row(P1, { stores: null })])).toEqual([]);
  });
});

describe("pending save (guest → sign in → saved)", () => {
  it("remembers one product for this tab; read once; expires", () => {
    rememberPendingSave(P1, 1000);
    expect(takePendingSave(2000)).toBe(P1);
    expect(takePendingSave(2000)).toBeNull();
    rememberPendingSave(P1, 1000);
    expect(takePendingSave(1000 + PENDING_MAX_AGE_MS + 1)).toBeNull();
    rememberPendingSave("not-a-uuid");
    expect(takePendingSave()).toBeNull();
    expect(parsePendingSave("{broken")).toBeNull();
  });
  it("store subdomain → main-site sign-in that returns to the product and saves it", () => {
    const prod = { rootDomain: "saloree.com", dev: false };
    const url = mainSiteSaveSignInUrl(P1, prod);
    expect(url.startsWith("https://saloree.com/login?redirect=")).toBe(true);
    const back = new URL(url).searchParams.get("redirect")!;
    expect(back).toBe(`/product/${P1}?saveToWishlist=${P1}`);
    expect(pendingSaveFromUrl(back)).toBe(P1);
    expect(withoutSaveParam(`${back}&x=1#top`)).toBe(`/product/${P1}?x=1#top`);
    expect(pendingSaveFromUrl("/product/x?saveToWishlist=<script>")).toBeNull();
  });
  it("the wishlist lives on the main domain", () => {
    expect(isMainOnlyPath("/wishlist")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Heart
// ---------------------------------------------------------------------------
describe("heart button", () => {
  const heart = (name: RegExp = /wishlist/i) => screen.findByRole("button", { name });

  it("guest: not pressed; tap → sign in and back, product remembered", async () => {
    const { router } = renderWithRouter(
      <WishlistButton productId={P1} title="Lamp" />,
      "/category/home?sort=new",
    );
    const button = await heart(/save lamp to your wishlist/i);
    expect(button).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(button);
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toEqual({ redirect: "/category/home?sort=new" });
    expect(takePendingSave()).toBe(P1);
    expect(m().state.queries).toHaveLength(0);
  });

  it("is a native button with a 44px class, label and aria-pressed (keyboard: Enter/Space)", async () => {
    signIn();
    m().state.queue.push({ data: [{ product_id: P1 }] });
    renderWithRouter(<WishlistButton productId={P1} title="Lamp" />);
    const button = await heart(/remove lamp from your wishlist/i);
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("wishlist-heart");
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).not.toHaveAttribute("tabindex", "-1");
    button.focus();
    expect(document.activeElement).toBe(button);
  });

  it("every heart for the product stays in sync (one cached query, optimistic)", async () => {
    signIn();
    m().state.queue.push({ data: [] }, { data: null }, { data: [{ product_id: P1 }] });
    renderWithRouter(
      <>
        <WishlistButton productId={P1} title="Lamp" />
        <WishlistButton productId={P1} title="Lamp" />
      </>,
    );
    const [a] = await screen.findAllByRole("button", { name: /save lamp/i });
    fireEvent.click(a!);
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("button", { name: /remove lamp/i })
          .map((b) => b.getAttribute("aria-pressed")),
      ).toEqual(["true", "true"]),
    );
    await waitFor(() => expect(h.toast.success).toHaveBeenCalledWith("Saved to your wishlist"));
    expect(
      m().state.queries.filter((q) => q.table === "wishlist_items" && q.calls[0]?.[0] === "select"),
    ).toHaveLength(2); // 1 load + 1 refresh
  });

  it("refused → rolled back, with the reason in plain words", async () => {
    signIn();
    m().state.queue.push(
      { data: [] },
      {
        error: {
          code: "42501",
          message: 'new row violates row-level security policy for table "wishlist_items"',
        },
      },
      { data: [] },
    );
    renderWithRouter(<WishlistButton productId={P1} title="Lamp" />);
    fireEvent.click(await heart(/save lamp/i));
    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith(
        "This product can't be saved right now. It may no longer be for sale.",
      ),
    );
    expect(await heart(/save lamp/i)).toHaveAttribute("aria-pressed", "false");
  });

  it("full list → 'Your wishlist is full (200 products)…'", async () => {
    signIn();
    m().state.queue.push(
      { data: [] },
      { error: { code: "P0001", message: "Your wishlist is full (200 products)" } },
      { data: [] },
    );
    renderWithRouter(<WishlistButton productId={P1} title="Lamp" />);
    fireEvent.click(await heart(/save lamp/i));
    await waitFor(() =>
      expect(h.toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/^Your wishlist is full \(200 products\)/),
      ),
    );
  });

  it("inside a card link, tapping the heart never navigates", async () => {
    signIn();
    m().state.queue.push({ data: [] });
    const { router } = renderWithRouter(
      <Link to="/product/$id" params={{ id: P1 }}>
        <WishlistButton productId={P1} title="Lamp" />
      </Link>,
    );
    fireEvent.click(await heart(/save lamp/i));
    await waitFor(() =>
      expect(m().callsOn("wishlist_items", 1)[0]).toEqual(["insert", { product_id: P1 }]),
    );
    expect(router.state.location.pathname).toBe("/");
  });
});

describe("after sign-in", () => {
  it("saves the product the guest tapped (sessionStorage)", async () => {
    rememberPendingSave(P2);
    signIn();
    renderWithRouter(<PendingWishlistSave />);
    await waitFor(() =>
      expect(m().callsOn("wishlist_items")[0]).toEqual(["insert", { product_id: P2 }]),
    );
    await waitFor(() =>
      expect(h.toast.success).toHaveBeenCalledWith(
        "You're signed in. The product is saved to your wishlist.",
      ),
    );
    expect(takePendingSave()).toBeNull();
  });

  it("saves the product carried from a store subdomain and cleans the address", async () => {
    signIn();
    const { router } = renderWithRouter(
      <PendingWishlistSave />,
      `/product/${P3}?saveToWishlist=${P3}`,
    );
    await waitFor(() =>
      expect(m().callsOn("wishlist_items")[0]).toEqual(["insert", { product_id: P3 }]),
    );
    expect(router.state.location.href).toBe(`/product/${P3}`);
  });

  it("does nothing for guests", async () => {
    rememberPendingSave(P2);
    renderWithRouter(<PendingWishlistSave />);
    await new Promise((r) => setTimeout(r, 50));
    expect(m().state.queries).toHaveLength(0);
    expect(takePendingSave()).toBe(P2);
  });
});

// ---------------------------------------------------------------------------
// /wishlist page
// ---------------------------------------------------------------------------
describe("/wishlist page", () => {
  const Page = WishlistRoute.options.component!;

  it("lists saved products with photo, title, price, store, stock and date; hides unavailable ones", async () => {
    signIn();
    m().state.queue.push({
      data: [row(P1), row(P2, { stock: 0, title: "Vase" }), row(P3, { status: "draft" })],
    });
    renderWithRouter(<Page />);
    const list = await screen.findByRole("list");
    const cards = within(list).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(screen.getByLabelText("2 saved products")).toHaveTextContent("2");
    const lamp = cards[0]!;
    // Product links use the readable slug (/product/<slug>); the id URL 301s there.
    expect(within(lamp).getByRole("link", { name: "Lamp 1" })).toHaveAttribute(
      "href",
      `/product/lamp-${P1.slice(0, 1)}`,
    );
    expect(lamp).toHaveTextContent("Alpha Store");
    expect(lamp).toHaveTextContent("$12.50");
    expect(lamp).toHaveTextContent("In stock · 3 available");
    expect(lamp).toHaveTextContent(/Saved Nov 10, 2026/);
    expect(within(cards[1]!).getByRole("button", { name: "Add Vase to cart" })).toBeDisabled();
  });

  it("Add to cart uses the cart (stock rules) and stops when the cart holds all stock", async () => {
    signIn();
    h.cart.items = [{ productId: P2, quantity: 3 }];
    m().state.queue.push({ data: [row(P1), row(P2, { title: "Vase" })] });
    renderWithRouter(<Page />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Lamp 1 to cart" }));
    expect(h.cart.add).toHaveBeenCalledWith(P1);
    const vase = screen.getByRole("button", { name: "Add Vase to cart" });
    expect(vase).toBeDisabled();
    expect(vase).toHaveTextContent("All in your cart");
  });

  it("Remove deletes the row and the item disappears", async () => {
    signIn();
    m().state.queue.push({ data: [row(P1)] }, { data: null }, { data: [] });
    renderWithRouter(<Page />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Remove Lamp 1 from your wishlist" }),
    );
    await waitFor(() =>
      expect(m().callsOn("wishlist_items", 1)).toContainEqual(["eq", "product_id", P1]),
    );
    expect(await screen.findByText("Your wishlist is empty")).toBeTruthy();
  });

  it("empty state offers to keep shopping", async () => {
    signIn();
    m().state.queue.push({ data: [] });
    renderWithRouter(<Page />);
    expect(await screen.findByText("Your wishlist is empty")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Keep shopping" })).toHaveAttribute(
      "href",
      "/products",
    );
  });

  it("table not created yet → plain words plus the real database error, never fake data", async () => {
    signIn();
    m().state.queue.push({
      error: {
        code: "PGRST205",
        message: "Could not find the table 'public.wishlist_items' in the schema cache",
      },
    });
    renderWithRouter(<Page />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "The wishlist isn't available yet: the database table is missing.",
    );
    expect(alert).toHaveTextContent(
      "Could not find the table 'public.wishlist_items' in the schema cache (PGRST205)",
    );
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("route: signed-in only (guest → sign in and back), noindex", async () => {
    await expect(
      (WishlistRoute.options.beforeLoad as (c: { location: { href: string } }) => Promise<unknown>)(
        {
          location: { href: "/wishlist" },
        },
      ),
    ).rejects.toMatchObject({ options: { to: "/login", search: { redirect: "/wishlist" } } });
    const head = (
      WishlistRoute.options.head as unknown as (c: { matches: [] }) => { meta: object[] }
    )({
      matches: [],
    });
    expect(head.meta).toContainEqual({ name: "robots", content: "noindex" });
    expect(WishlistRoute.options.ssr).toBe(false);
  });
});
