import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type AnyRouter,
} from "@tanstack/react-router";

const auth = vi.hoisted(() => ({
  value: { user: null as { id: string } | null, roles: [] as string[], ready: true },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => auth.value }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import { StorefrontTracker } from "@/components/marketplace/storefront-tracker";
import { isCountedViewer, sendTrack, trackedStoreSlug } from "@/lib/storefront-tracking";
import type { Catalog, Store } from "@/data/catalog";

const STORE_ID = "6f1c2b0a-4d3e-4f5a-9b8c-7d6e5f4a3b2c";
const OWNER = "owner-1";

describe("trackedStoreSlug: what is a storefront view", () => {
  const main = { siteStoreSlug: null, productStoreSlug: null };
  const site = { siteStoreSlug: "beta", productStoreSlug: null };

  it("store's own site: home, all products, a category, a product page", () => {
    expect(trackedStoreSlug("/", site)).toBe("beta");
    expect(trackedStoreSlug("/products", site)).toBe("beta");
    expect(trackedStoreSlug("/products/", site)).toBe("beta");
    expect(trackedStoreSlug("/category/lamps", site)).toBe("beta");
    expect(trackedStoreSlug("/product/p1", { ...site, productStoreSlug: "beta" })).toBe("beta");
  });

  it("main site: the store page and a product page of a store", () => {
    expect(trackedStoreSlug("/store/beta", main)).toBe("beta");
    expect(trackedStoreSlug("/product/p1", { ...main, productStoreSlug: "alpha" })).toBe("alpha");
  });

  it("never the marketplace, checkout, cart, account, seller, admin or preview", () => {
    for (const path of [
      "/",
      "/products",
      "/stores",
      "/category/lamps",
      "/checkout",
      "/cart",
      "/account",
      "/wishlist",
      "/seller",
      "/seller/analytics",
      "/admin",
      "/preview/store",
      "/login",
      "/order-confirmation/x",
    ])
      expect(trackedStoreSlug(path, main), path).toBeNull();
    for (const path of ["/cart", "/help", "/preview/store", "/seller", "/product/p1"])
      expect(trackedStoreSlug(path, site), `site ${path}`).toBeNull(); // product: not loaded
  });
});

describe("isCountedViewer", () => {
  const store = { ownerId: OWNER };
  it("counts visitors and other signed-in users", () => {
    expect(isCountedViewer({ userId: null, roles: [] }, store)).toBe(true);
    expect(isCountedViewer({ userId: "u2", roles: ["customer", "seller"] }, store)).toBe(true);
  });
  it("never the store's owner or staff", () => {
    expect(isCountedViewer({ userId: OWNER, roles: ["seller"] }, store)).toBe(false);
    for (const role of ["admin", "content_admin", "finance_admin"])
      expect(isCountedViewer({ userId: "u3", roles: [role] }, store), role).toBe(false);
  });
});

describe("sendTrack", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends only { store_id } with sendBeacon", () => {
    const beacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: beacon });
    sendTrack(STORE_ID);
    expect(beacon).toHaveBeenCalledWith("/api/track", JSON.stringify({ store_id: STORE_ID }));
  });

  it("falls back to fetch with keepalive, and never throws", async () => {
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: () => false });
    const fetchMock = vi.fn(async () => {
      throw new Error("offline");
    });
    vi.stubGlobal("fetch", fetchMock);
    expect(() => sendTrack(STORE_ID)).not.toThrow();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/track",
      expect.objectContaining({
        method: "POST",
        keepalive: true,
        credentials: "omit",
        body: JSON.stringify({ store_id: STORE_ID }),
      }),
    );
    await Promise.resolve();
  });
});

// ---------------------------------------------------------------------------
// The tracker in a router: a store's own site
// ---------------------------------------------------------------------------
const store: Store = {
  id: STORE_ID,
  slug: "beta",
  name: "Beta Decor",
  initials: "BD",
  description: "",
  rating: 0,
  specialty: "",
  image: "",
  tone: "sage",
  ownerId: OWNER,
};

function setup({ siteStore }: { siteStore: Store | null }) {
  const qc = new QueryClient();
  qc.setQueryData<Catalog>(["catalog"], { products: [], stores: [store], categories: [] });
  const root = createRootRoute({
    loader: () => ({ store: siteStore, theme: null }),
    component: () => (
      <>
        <StorefrontTracker />
        <Outlet />
      </>
    ),
  });
  const page = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: () => <p>{path}</p> });
  const router = createRouter({
    routeTree: root.addChildren(["/", "/products", "/cart"].map(page)),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(
    <QueryClientProvider client={qc}>
      <RouterProvider router={router as AnyRouter} />
    </QueryClientProvider>,
  );
  return router;
}

const go = (router: AnyRouter, to: string) =>
  act(async () => {
    await router.navigate({ to });
  });

describe("StorefrontTracker", () => {
  let beacon: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    beacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { ...navigator, sendBeacon: beacon });
    auth.value = { user: null, roles: [], ready: true };
  });
  afterEach(() => vi.unstubAllGlobals());

  it("counts one view per storefront navigation, none for the cart", async () => {
    const router = setup({ siteStore: store });
    await screen.findByText("/");
    expect(beacon).toHaveBeenCalledTimes(1);
    await go(router, "/products");
    await screen.findByText("/products");
    expect(beacon).toHaveBeenCalledTimes(2);
    await go(router, "/cart");
    await screen.findByText("/cart");
    expect(beacon).toHaveBeenCalledTimes(2);
    for (const call of beacon.mock.calls)
      expect(call).toEqual(["/api/track", JSON.stringify({ store_id: STORE_ID })]);
  });

  it("does not count the store's owner", async () => {
    auth.value = { user: { id: OWNER }, roles: ["seller"], ready: true };
    setup({ siteStore: store });
    await screen.findByText("/");
    expect(beacon).not.toHaveBeenCalled();
  });

  it("does not count staff", async () => {
    auth.value = { user: { id: "staff-1" }, roles: ["admin"], ready: true };
    setup({ siteStore: store });
    await screen.findByText("/");
    expect(beacon).not.toHaveBeenCalled();
  });

  it("waits until sign-in is known", async () => {
    auth.value = { user: null, roles: [], ready: false };
    setup({ siteStore: store });
    await screen.findByText("/");
    expect(beacon).not.toHaveBeenCalled();
  });

  it("never counts the marketplace home", async () => {
    setup({ siteStore: null });
    await screen.findByText("/");
    expect(beacon).not.toHaveBeenCalled();
  });
});
