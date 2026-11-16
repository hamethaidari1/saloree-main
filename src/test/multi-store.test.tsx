import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { createSupabaseMock } from "./supabase-mock";
import { renderWithRouter, testQueryClient } from "./router-harness";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

import type { StoreRow } from "@/data/db";
import {
  ACTIVE_STORE_KEY,
  agreementAccepted,
  readActiveStoreId,
  resolveActiveStore,
  writeActiveStoreId,
} from "@/lib/active-store";
import { signOut } from "@/lib/auth";
import { legalDocument } from "@/services/legal";
import { sellerService, storeError } from "@/services/seller";
import { sellerDashboardService } from "@/services/seller-dashboard";
import {
  canCreateStore,
  limitInputSchema,
  StoreLimitError,
  storeLimitSchema,
  storeLimitService,
} from "@/services/store-limits";
import { SellerProvider, type SellerContextValue } from "@/components/seller/seller-context";
import { StoreSwitcher } from "@/components/seller/store-switcher";
import { CreateStoreForm } from "@/components/seller/create-store";
import { useCreateStore } from "@/components/seller/use-create-store";
import { StoreLimitControl } from "@/components/staff/store-limit";

const m = () => mock.current!;
const USER = "6f1c2b0a-4d3e-4f5a-9b8c-7d6e5f4a3b2c";
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FOREIGN = "ffffffff-ffff-4fff-8fff-ffffffffffff";

const storeRow = (id: string, patch: Partial<StoreRow> = {}): StoreRow => ({
  id,
  owner_id: USER,
  seller_agreement_version: null,
  name: `Store ${id.slice(0, 1).toUpperCase()}`,
  slug: `store-${id.slice(0, 1)}`,
  description: null,
  logo_url: null,
  banner_url: null,
  category: null,
  location: null,
  status: "draft",
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  ...patch,
});

beforeEach(() => {
  m().reset();
  m().state.session = { user: { id: USER } };
  window.localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// The active store
// ---------------------------------------------------------------------------
describe("active store", () => {
  const mine = [storeRow(A), storeRow(B)];

  it("uses the remembered store only when it is one of mine", () => {
    expect(resolveActiveStore(mine, B)?.id).toBe(B);
    // An id left by someone else (or a deleted store) is ignored: first of mine.
    expect(resolveActiveStore(mine, FOREIGN)?.id).toBe(A);
    expect(resolveActiveStore(mine, null)?.id).toBe(A);
    expect(resolveActiveStore([], B)).toBeNull();
  });

  it("stores only an id, and ignores anything that isn't one", () => {
    writeActiveStoreId(A);
    expect(window.localStorage.getItem(ACTIVE_STORE_KEY)).toBe(A);
    expect(readActiveStoreId()).toBe(A);
    window.localStorage.setItem(ACTIVE_STORE_KEY, '{"id":"x"}');
    expect(readActiveStoreId()).toBeNull();
    window.localStorage.setItem(ACTIVE_STORE_KEY, "x".repeat(200));
    expect(readActiveStoreId()).toBeNull();
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readActiveStoreId()).toBeNull();
    expect(() => writeActiveStoreId(A)).not.toThrow();
  });

  it("sign-out clears the active store", async () => {
    writeActiveStoreId(B);
    await signOut();
    expect(window.localStorage.getItem(ACTIVE_STORE_KEY)).toBeNull();
  });

  it("my stores are read by owner (the switcher lists only these)", async () => {
    m().state.queue.push({ data: [storeRow(A)] });
    await sellerService.getMyStores();
    const q = m().state.queries.find((r) => r.table === "stores")!;
    expect(q.calls).toContainEqual(["eq", "owner_id", USER]);
  });
});

// ---------------------------------------------------------------------------
// The switcher
// ---------------------------------------------------------------------------
function seller(patch: Partial<SellerContextValue> = {}): SellerContextValue {
  const stores = patch.stores ?? [storeRow(A, { status: "published" }), storeRow(B)];
  return {
    user: { id: USER } as User,
    store: stores[0]!,
    stores,
    setStoreId: vi.fn(),
    categories: [],
    storesKey: ["seller", "stores", USER],
    ...patch,
  };
}
const openMenu = async () =>
  fireEvent.keyDown(await screen.findByTestId("store-switcher"), { key: "Enter" });

describe("store switcher", () => {
  const limit = (max_stores: number, used: number) =>
    vi.spyOn(storeLimitService, "mine").mockResolvedValue({ max_stores, used });

  it("shows the active store and lists only the stores it is given, with Active on one", async () => {
    limit(3, 2);
    vi.spyOn(sellerDashboardService, "pendingByStore").mockResolvedValue({});
    const value = seller();
    renderWithRouter(
      <SellerProvider value={value}>
        <StoreSwitcher compact={false} />
      </SellerProvider>,
    );
    const trigger = await screen.findByTestId("store-switcher");
    expect(trigger).toHaveTextContent("Store A");
    expect(trigger).toHaveTextContent("published");
    await openMenu();
    const items = await screen.findAllByTestId("store-switch-item");
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining("Store A"),
      expect.stringContaining("Store B"),
    ]);
    expect(items[0]).toHaveAttribute("aria-current", "true");
    expect(items[0]).toHaveTextContent("Active");
    expect(items[1]).not.toHaveAttribute("aria-current");
    expect(await screen.findByTestId("store-count")).toHaveTextContent("Stores: 2 of 3");
    expect(screen.getByTestId("create-another-store")).toHaveAttribute(
      "href",
      "/seller/stores/new",
    );
    // Choosing the other store switches; the page stays the same type (no navigation).
    fireEvent.click(items[1]!);
    expect(value.setStoreId).toHaveBeenCalledWith(B);
  });

  it("disables Create another store at the limit, with the reason", async () => {
    limit(3, 3);
    vi.spyOn(sellerDashboardService, "pendingByStore").mockResolvedValue({});
    renderWithRouter(
      <SellerProvider value={seller()}>
        <StoreSwitcher compact={false} />
      </SellerProvider>,
    );
    await openMenu();
    const reason = await screen.findByTestId("store-limit-reason");
    expect(reason).toHaveTextContent(
      "You have reached your store limit (3 of 3). Contact Saloree support to open more.",
    );
    const create = screen.getByTestId("create-another-store");
    expect(create).toHaveAttribute("aria-disabled", "true");
    expect(create).not.toHaveAttribute("href");
    expect(create).toHaveAttribute("aria-describedby", "store-limit-reason");
    expect(screen.getByTestId("store-count")).toHaveTextContent("Stores: 3 of 3");
  });

  it("shows a dot only when ANOTHER store has new orders", async () => {
    limit(3, 2);
    const pending = vi
      .spyOn(sellerDashboardService, "pendingByStore")
      .mockResolvedValue({ [A]: 4 }); // the active store's own orders: no dot
    const { unmount } = renderWithRouter(
      <SellerProvider value={seller()}>
        <StoreSwitcher compact={false} />
      </SellerProvider>,
    );
    await waitFor(() => expect(pending).toHaveBeenCalledWith([A, B].sort()));
    expect(screen.queryByTestId("other-store-dot")).toBeNull();
    unmount();

    pending.mockResolvedValue({ [B]: 1 });
    renderWithRouter(
      <SellerProvider value={seller()}>
        <StoreSwitcher compact={false} />
      </SellerProvider>,
    );
    expect(await screen.findByTestId("other-store-dot")).toBeInTheDocument();
    expect(screen.getByTestId("store-switcher")).toHaveAccessibleName(
      /another store has new orders/,
    );
  });

  it("does not ask for other stores' orders when there is only one store", async () => {
    limit(1, 1);
    const pending = vi.spyOn(sellerDashboardService, "pendingByStore");
    renderWithRouter(
      <SellerProvider value={seller({ stores: [storeRow(A)] })}>
        <StoreSwitcher compact={false} />
      </SellerProvider>,
    );
    await openMenu();
    await screen.findByTestId("store-count");
    expect(pending).not.toHaveBeenCalled();
  });

  it("pendingByStore counts pending orders per store", async () => {
    m().state.queue.push({ data: [{ store_id: A }, { store_id: B }, { store_id: B }] });
    expect(await sellerDashboardService.pendingByStore([A, B])).toEqual({ [A]: 1, [B]: 2 });
    const q = m().state.queries.at(-1)!;
    expect(q.table).toBe("orders");
    expect(q.calls).toContainEqual(["in", "store_id", [A, B]]);
    expect(q.calls).toContainEqual(["eq", "status", "pending"]);
  });
});

// ---------------------------------------------------------------------------
// Every seller page works on the active store only
// ---------------------------------------------------------------------------
describe("per-store query keys", () => {
  // Across my stores by design: Support lists every store's orders, the "All stores"
  // row, and the switcher's other-store dot.
  const PER_PERSON = ['"support-orders"', '"all-stores"', '"pending-by-store"'];
  const dirs = ["src/routes", "src/components/seller"];
  const files = dirs.flatMap((d) =>
    readdirSync(join(process.cwd(), d))
      .filter((f) => /\.tsx?$/.test(f) && (d !== "src/routes" || f.startsWith("seller.")))
      .map((f) => `${d}/${f}`),
  );

  it("every seller query key literal carries the store id", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      for (const hit of src.matchAll(/(?:queryKey:|const \w*[kK]ey =)\s*(\["seller",[^\]]*\])/g)) {
        const key = hit[1]!;
        // Invalidating a prefix ("every store's pending count") is meant to reach all stores.
        const before = src.slice(Math.max(0, hit.index - 40), hit.index);
        if (/(invalidate|cancel)Queries\(\{\s*$/.test(before)) continue;
        if (PER_PERSON.some((p) => key.includes(p))) continue;
        if (!/store\.id|storeId|\.\.\.storeIds|\bid\b/.test(key)) offenders.push(`${f}: ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the page is remounted per store, and Orders gets only the active store", () => {
    const layout = readFileSync(join(process.cwd(), "src/routes/seller.tsx"), "utf8");
    expect(layout).toMatch(/<Fragment key=\{store\.id\}>\s*<Outlet \/>/);
    const orders = readFileSync(join(process.cwd(), "src/routes/seller.orders.tsx"), "utf8");
    expect(orders).toContain("stores={[store]}");
  });

  it("analytics and customers pass p_store_id (null = all my stores)", async () => {
    m().state.fallback = { data: null, error: null };
    await sellerDashboardService.analytics(7, A).catch(() => undefined);
    await sellerDashboardService.analytics(7, null).catch(() => undefined);
    await sellerDashboardService.customers(B).catch(() => undefined);
    expect(m().state.rpcs).toEqual([
      { fn: "seller_analytics", args: { p_days: 7, p_store_id: A } },
      { fn: "seller_analytics", args: { p_days: 7, p_store_id: null } },
      { fn: "seller_customers", args: { p_store_id: B } },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Store limits
// ---------------------------------------------------------------------------
describe("store limits", () => {
  it("my_store_limit: object or one-row array; canCreateStore", async () => {
    expect(storeLimitSchema.parse([{ max_stores: 3, used: 1 }])).toEqual({
      max_stores: 3,
      used: 1,
    });
    m().state.queue.push({ data: { max_stores: "2", used: "2" } });
    const l = await storeLimitService.mine();
    expect(l).toEqual({ max_stores: 2, used: 2 });
    expect(canCreateStore(l)).toBe(false);
    expect(canCreateStore({ max_stores: 3, used: 2 })).toBe(true);
    expect(canCreateStore(undefined)).toBe(false);
  });

  it("a missing function shows the real database error", async () => {
    m().state.queue.push({
      error: { message: "Could not find the function public.my_store_limit", code: "PGRST202" },
    });
    await expect(storeLimitService.mine()).rejects.toMatchObject({ code: "PGRST202" });
  });

  it("forSeller: no row means the default 1; counts the owner's stores", async () => {
    m().state.queue.push({ data: null }, { count: 1 });
    expect(await storeLimitService.forSeller(USER)).toEqual({ max_stores: 1, used: 1 });
    const [limits, stores] = m().state.queries;
    expect(limits!.table).toBe("seller_store_limits");
    expect(limits!.calls).toContainEqual(["eq", "user_id", USER]);
    expect(stores!.calls).toContainEqual(["eq", "owner_id", USER]);
  });

  it("setForSeller validates 1..20 before calling set_seller_store_limit", async () => {
    for (const bad of [0, 21, 2.5, "x", ""]) {
      await expect(storeLimitService.setForSeller(USER, bad)).rejects.toThrow();
      expect(limitInputSchema.safeParse(bad).success).toBe(false);
    }
    expect(m().state.rpcs).toEqual([]);
    await storeLimitService.setForSeller(USER, "5");
    expect(m().state.rpcs).toEqual([
      { fn: "set_seller_store_limit", args: { p_user: USER, p_max: 5 } },
    ]);
  });

  it("the trigger's limit error is shown as the database wrote it", () => {
    const msg =
      "Store limit reached: you can have 1 store(s). Contact Saloree support to open more.";
    expect(storeError({ message: msg, code: "P0001" })).toBe(msg);
  });
});

// ---------------------------------------------------------------------------
// Create another store
// ---------------------------------------------------------------------------
describe("create another store", () => {
  const version = legalDocument("seller-agreement")?.updated ?? null;

  it("has a Seller Agreement version to compare", () => {
    expect(version).toBeTruthy();
  });

  it("does not ask the agreement again when the current version was accepted", async () => {
    expect(agreementAccepted([storeRow(A, { seller_agreement_version: version })], version)).toBe(
      true,
    );
    expect(
      agreementAccepted([storeRow(A, { seller_agreement_version: "2020-01-01" })], version),
    ).toBe(false);
    expect(agreementAccepted([], version)).toBe(false);
    expect(agreementAccepted([storeRow(A, { seller_agreement_version: null })], null)).toBe(false);

    const form = (stores: StoreRow[]) =>
      renderWithRouter(
        <CreateStoreForm
          stores={stores}
          categoryNames={["Home"]}
          busy={false}
          error={null}
          onSubmit={async () => undefined}
        />,
      );
    const { unmount } = form([storeRow(A, { seller_agreement_version: version })]);
    expect(await screen.findByTestId("agreement-carried")).toBeInTheDocument();
    expect(document.getElementById("store-agreement")).toBeNull();
    unmount();

    // The agreement changed since: asked again.
    form([storeRow(A, { seller_agreement_version: "2020-01-01" })]);
    await screen.findByRole("button", { name: "Create store" });
    expect(screen.queryByTestId("agreement-carried")).toBeNull();
    expect(document.getElementById("store-agreement")).not.toBeNull();
  });

  it("shows the database's limit error under the form", async () => {
    const msg =
      "Store limit reached: you can have 1 store(s). Contact Saloree support to open more.";
    renderWithRouter(
      <CreateStoreForm
        stores={[storeRow(A)]}
        categoryNames={[]}
        busy={false}
        error={{ message: msg, code: "P0001" }}
        onSubmit={async () => undefined}
      />,
    );
    expect(await screen.findByTestId("create-store-error")).toHaveTextContent(msg);
  });

  it("a created store records the agreement version, refreshes stores and limit, and becomes active", async () => {
    const created = storeRow(B, { name: "Second" });
    vi.spyOn(sellerService, "createStore").mockResolvedValue(created);
    const record = vi.spyOn(sellerService, "recordSellerAgreement").mockResolvedValue(undefined);
    const client = testQueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const onCreated = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () => useCreateStore({ userId: USER, storesKey: ["seller", "stores", USER], onCreated }),
      { wrapper },
    );
    await act(() =>
      result.current.mutateAsync([
        { name: "Second", slug: "second" } as Parameters<typeof sellerService.createStore>[0],
        {},
      ]),
    );
    expect(record).toHaveBeenCalledWith(B, version);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["seller", "stores", USER] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["seller", "store-limit", USER] });
    expect(onCreated).toHaveBeenCalledWith(created);
  });
});

// ---------------------------------------------------------------------------
// Admin: store limit control
// ---------------------------------------------------------------------------
describe("admin store limit control", () => {
  const show = (canEdit: boolean) =>
    render(
      <QueryClientProvider client={testQueryClient()}>
        <StoreLimitControl userId={USER} canEdit={canEdit} />
      </QueryClientProvider>,
    );

  it("staff without admin see the limit but no control", async () => {
    vi.spyOn(storeLimitService, "forSeller").mockResolvedValue({ max_stores: 1, used: 1 });
    show(false);
    expect(await screen.findByTestId("store-limit")).toHaveTextContent("Store limit: 1 (uses 1)");
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  });

  it("admins change it after confirming; out-of-range values are refused first", async () => {
    vi.spyOn(storeLimitService, "forSeller").mockResolvedValue({ max_stores: 1, used: 1 });
    const set = vi.spyOn(storeLimitService, "setForSeller").mockResolvedValue(undefined);
    show(true);
    const input = await screen.findByRole("spinbutton", { name: "New limit" });
    fireEvent.change(input, { target: { value: "21" } });
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter a whole number from 1 to 20.",
    );
    expect(set).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(await screen.findByRole("button", { name: "Set limit" }));
    await waitFor(() => expect(set).toHaveBeenCalledWith(USER, 3));
  });

  it("a refused change shows the database error as it is", async () => {
    vi.spyOn(storeLimitService, "forSeller").mockResolvedValue({ max_stores: 1, used: 1 });
    vi.spyOn(storeLimitService, "setForSeller").mockRejectedValue(
      new StoreLimitError("Only admins can change store limits", "42501"),
    );
    show(true);
    fireEvent.change(await screen.findByRole("spinbutton"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(await screen.findByRole("button", { name: "Set limit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only admins can change store limits (42501)",
    );
  });

  it("only admins get the control in the staff screens", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    expect(read("src/routes/admin.tsx")).toMatch(/<StoresPanel canSetLimit \/>/);
    expect(read("src/routes/admin.tsx")).toMatch(
      /<SellerApplicationsPanel canReview canSetLimit \/>/,
    );
    expect(read("src/routes/admin_.marketplace.tsx")).toContain("canSetLimit={isAdmin}");
    expect(read("src/routes/admin_.marketplace.tsx")).toContain(
      'isAdmin = roles.includes("admin")',
    );
    expect(read("src/routes/admin_.finance.tsx")).toContain(
      'canSetLimit={roles.includes("admin")}',
    );
  });
});
