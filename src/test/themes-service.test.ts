import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "./supabase-mock";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

import {
  centsToPrice,
  loadThemeForStorefront,
  priceToCents,
  saveAppearance,
  storeThemeQuery,
  templatesAdminService,
  themeError,
  themesService,
} from "@/services/themes";
import { sellerService } from "@/services/seller";
import {
  buildSaveArgs,
  draftFromSaved,
  isDirty,
  nameError,
  previewSettings,
  resetSection,
  settingsErrors,
} from "@/components/seller/customize-state";
import { formatPrice, isUnlocked } from "@/components/seller/theme-data";
import { hidesSiteChrome } from "@/lib/layout";
import { SELLER_NAV } from "@/components/seller/seller-shell";
import { TEMPLATES } from "@/templates/registry";
import type { StoreRow, StoreTemplateRow } from "@/data/db";

const m = () => mock.current!;
beforeEach(() => m().reset());

const STORE = "11111111-1111-4111-8111-111111111111";
const TPL = "22222222-2222-4222-8222-222222222222";
const base = {
  storeId: STORE,
  templateId: TPL,
  settings: {},
  name: null,
  description: null,
  logoUrl: null,
  bannerUrl: null,
};

describe("themesService (reading)", () => {
  it("lists active templates in sort order", async () => {
    m().state.queue.push({ data: [{ id: TPL, code: "classic" }] });
    await themesService.listActive();
    const calls = m().callsOn("store_templates");
    expect(calls).toContainEqual(["eq", "is_active", true]);
    expect(calls).toContainEqual(["order", "sort_order"]);
  });

  it("reads a store's theme with its template code (object or array embed)", async () => {
    m().state.queue.push({
      data: {
        template_id: TPL,
        settings: { primary: "#000000" },
        store_templates: { code: "market", is_active: true },
      },
    });
    expect(await themesService.getStoreTheme(STORE)).toEqual({
      templateId: TPL,
      code: "market",
      isActive: true,
      settings: { primary: "#000000" },
    });
    m().state.queue.push({
      data: {
        template_id: TPL,
        settings: {},
        store_templates: [{ code: "bold", is_active: false }],
      },
    });
    expect(await themesService.getStoreTheme(STORE)).toMatchObject({
      code: "bold",
      isActive: false,
    });
    expect(m().callsOn("store_themes")).toContainEqual(["eq", "store_id", STORE]);
  });

  it("no saved row → null (Classic)", async () => {
    m().state.queue.push({ data: null });
    expect(await themesService.getStoreTheme(STORE)).toBeNull();
  });

  it("lists a store's unlocked template ids", async () => {
    m().state.queue.push({ data: [{ template_id: TPL }] });
    expect(await themesService.getGrants(STORE)).toEqual([TPL]);
  });

  it("storefront falls back to Classic (null) when the theme can't be read", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ensure = vi.fn(async () => {
      throw { code: "PGRST205", message: "Could not find the table 'public.store_themes'" };
    });
    expect(await loadThemeForStorefront(ensure, STORE)).toBeNull();
    expect(warn.mock.calls[0]?.[0]).toMatch(/public\.store_themes/);
    expect(await loadThemeForStorefront(ensure, undefined)).toBeNull();
    expect(storeThemeQuery(STORE).queryKey).toEqual(["store-theme", STORE]);
    warn.mockRestore();
  });

  it("shows the real database error for missing objects", () => {
    expect(
      themeError({
        code: "PGRST202",
        message: "Could not find the function public.save_store_appearance",
      }),
    ).toBe(
      "Store templates aren't set up in the database yet: Could not find the function public.save_store_appearance",
    );
    expect(
      themeError({
        code: "P0001",
        message: "This premium template has not been unlocked for your store",
      }),
    ).toBe("This premium template has not been unlocked for your store");
  });
});

describe("saveAppearance", () => {
  it("calls save_store_appearance with exactly the contract's parameters", async () => {
    await saveAppearance({
      ...base,
      settings: { primary: "#112233", show_about: false },
      name: "  New Name ",
      description: "",
      logoUrl: "https://img.example/logo.png",
    });
    expect(m().state.rpcs).toEqual([
      {
        fn: "save_store_appearance",
        args: {
          p_store_id: STORE,
          p_template_id: TPL,
          p_settings: { primary: "#112233", show_about: false },
          p_name: "New Name",
          p_description: "",
          p_logo_url: "https://img.example/logo.png",
          p_banner_url: null,
        },
      },
    ]);
  });

  it.each([
    [{ settings: { primary: "red" } }, "bad colour"],
    [{ settings: { primary: "#12345" } }, "short colour"],
    [{ settings: { font_body: "comic" } }, "font not in the list"],
    [{ settings: { css: "body{display:none}" } }, "unknown key"],
    [{ settings: { hero_image_url: "http://x.example/a.jpg" } }, "non-https hero"],
    [{ logoUrl: "javascript:alert(1)" }, "unsafe logo"],
    [{ bannerUrl: "http://x.example/b.jpg" }, "http banner"],
    [{ name: "A" }, "too-short name"],
  ])("rejects %j (%s) before reaching the database", async (patch, _why) => {
    await expect(saveAppearance({ ...base, ...patch } as never)).rejects.toThrow();
    expect(m().state.rpcs).toEqual([]);
  });

  it("passes the database's premium lock message through", async () => {
    m().state.queue.push({
      error: {
        code: "P0001",
        message: "This premium template has not been unlocked for your store",
      },
    });
    const e = await saveAppearance(base).catch((x: unknown) => x);
    expect(themeError(e)).toBe("This premium template has not been unlocked for your store");
  });
});

describe("templatesAdminService", () => {
  const input = {
    name: "Editorial",
    description: "Magazine style",
    category: "Fashion",
    is_premium: true,
    price_cents: 1999,
    currency: "usd",
    is_active: true,
    sort_order: 4,
  };
  it("updates only editable columns and never deletes", async () => {
    m().state.queue.push({ data: [{ id: TPL }] });
    await templatesAdminService.update(TPL, input);
    const upd = m()
      .callsOn("store_templates")
      .find(([k]) => k === "update")?.[1];
    expect(upd).toEqual({ ...input, currency: "USD" });
    expect(Object.keys(templatesAdminService)).not.toContain("remove");
  });
  it("validates currency and price", async () => {
    await expect(templatesAdminService.update(TPL, { ...input, currency: "US" })).rejects.toThrow();
    await expect(
      templatesAdminService.update(TPL, { ...input, price_cents: -1 }),
    ).rejects.toThrow();
    expect(m().state.queries).toEqual([]);
  });
  it("grants as an admin grant by the current admin, and revokes", async () => {
    await templatesAdminService.grant(STORE, TPL);
    expect(
      m()
        .callsOn("store_template_grants")
        .find(([k]) => k === "insert")?.[1],
    ).toEqual({
      store_id: STORE,
      template_id: TPL,
      source: "admin_grant",
      granted_by: "user-1",
    });
    m().state.queue.push({ data: [{ store_id: STORE }] });
    await templatesAdminService.revoke(STORE, TPL);
    const calls = m().callsOn("store_template_grants", 1);
    expect(calls).toContainEqual(["eq", "store_id", STORE]);
    expect(calls).toContainEqual(["eq", "template_id", TPL]);
  });
  it("lists grants with store and template names", async () => {
    m().state.queue.push({ data: [] });
    await templatesAdminService.listGrants();
    expect(m().callsOn("store_template_grants")[0]).toEqual([
      "select",
      "*, stores(name, slug), store_templates(name, code)",
    ]);
  });
  it("prices convert between text and cents", () => {
    expect(priceToCents("12.50")).toBe(1250);
    expect(priceToCents("12")).toBe(1200);
    expect(priceToCents("")).toBeNull();
    expect(() => priceToCents("12.345")).toThrow();
    expect(() => priceToCents("-1")).toThrow();
    expect(centsToPrice(1250)).toBe("12.50");
    expect(centsToPrice(1200)).toBe("12");
    expect(centsToPrice(null)).toBe("");
  });
});

describe("sellerService.uploadStoreImage", () => {
  it("uploads into the seller's own folder", async () => {
    const file = new File([new Uint8Array(10)], "logo.png", { type: "image/png" });
    const url = await sellerService.uploadStoreImage("logo", file);
    expect(m().state.uploads[0]?.bucket).toBe("store-logos");
    expect(m().state.uploads[0]?.path).toMatch(/^user-1\/logos\/[0-9a-f-]{36}\.png$/);
    expect(url).toMatch(/^https:\/\/.*\/store-logos\/user-1\/logos\//);
    await sellerService.uploadStoreImage("banner", file);
    expect(m().state.uploads[1]?.path).toMatch(/^user-1\/banners\//);
  });
});

// ---------------------------------------------------------------------------
describe("Customize editor state", () => {
  const store = {
    id: STORE,
    owner_id: "u",
    name: "Kabul Goods",
    slug: "kabul-goods",
    description: "Old",
    logo_url: "https://img.example/logo.png",
    banner_url: null,
    category: null,
    location: null,
    status: "published",
    created_at: "",
    updated_at: "",
  } satisfies StoreRow;
  const defaults = TEMPLATES.classic.defaults;
  const saved = { ...defaults, primary: "#000000" };

  it("starts clean, becomes dirty on any change, clean again on undo", () => {
    const b = draftFromSaved(store, saved);
    expect(isDirty(b, b)).toBe(false);
    expect(isDirty({ ...b, name: "New" }, b)).toBe(true);
    expect(isDirty({ ...b, settings: { ...b.settings, grid_columns: 2 } }, b)).toBe(true);
    expect(isDirty({ ...b, logo: { file: new File([], "x.png"), url: b.logo.url } }, b)).toBe(true);
    expect(isDirty({ ...b, banner: { file: null, url: "" } }, b)).toBe(false);
    expect(isDirty({ ...b, logo: { file: null, url: "" } }, b)).toBe(true);
  });

  it("an invalid colour is a field error (Save is blocked) and never reaches the preview", () => {
    const b = draftFromSaved(store, saved);
    const bad = { ...b, settings: { ...b.settings, accent: "#12G" } };
    expect(settingsErrors(bad.settings)).toEqual({ accent: "Use a colour like #1A2B3C." });
    expect(previewSettings(defaults, bad).accent).toBe(defaults.accent);
    expect(() => buildSaveArgs(bad, b, defaults)).toThrow();
    expect(nameError("A")).toMatch(/at least 2/);
    expect(nameError("Kabul Goods")).toBeNull();
  });

  it("saves only changed fields, and only settings that differ from the template defaults", () => {
    const b = draftFromSaved(store, saved);
    const d = {
      ...b,
      name: " Kabul Goods & Co ",
      settings: { ...b.settings, hero_title: "Eid sale" },
      logo: { file: null, url: "" },
    };
    expect(buildSaveArgs(d, b, defaults)).toEqual({
      settings: { primary: "#000000", hero_title: "Eid sale" },
      name: "Kabul Goods & Co",
      description: null,
      logoUrl: "", // cleared
      bannerUrl: null, // unchanged
    });
    expect(buildSaveArgs(d, b, defaults, { banner: "https://x/b.png" }).bannerUrl).toBe(
      "https://x/b.png",
    );
  });

  it("reset puts one section back to the template defaults only", () => {
    const s = { ...saved, primary: "#111111", hero_title: "Keep me" };
    const r = resetSection(s, defaults, "colors");
    expect(r.primary).toBe(defaults.primary);
    expect(r.hero_title).toBe("Keep me");
  });
});

describe("Themes page helpers", () => {
  const row = (p: Partial<StoreTemplateRow>): StoreTemplateRow => ({
    id: TPL,
    code: "editorial",
    name: "Editorial",
    description: null,
    category: null,
    is_premium: true,
    price_cents: 1999,
    currency: "USD",
    sort_order: 1,
    is_active: true,
    ...p,
  });
  it("premium is locked until a grant exists; free never is", () => {
    expect(isUnlocked(row({}), new Set())).toBe(false);
    expect(isUnlocked(row({}), new Set([TPL]))).toBe(true);
    expect(isUnlocked(row({ is_premium: false }), new Set())).toBe(true);
  });
  it("formats prices from cents", () => {
    expect(formatPrice(1999, "USD")).toBe("$19.99");
    expect(formatPrice(null, "USD")).toBeNull();
  });
});

describe("navigation", () => {
  it("Online Store group has Themes and Customize", () => {
    const group = SELLER_NAV.find((i) => i.label === "Online Store");
    expect(group && "children" in group && group.children.map((c) => c.to)).toEqual([
      "/seller/themes",
      "/seller/customize",
    ]);
  });
  it("the owner preview shows the store, not the marketplace chrome", () => {
    expect(hidesSiteChrome("/preview/store")).toBe(true);
    expect(hidesSiteChrome("/preview")).toBe(false);
  });
});
