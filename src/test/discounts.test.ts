import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseMock } from "./supabase-mock";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

import {
  discountError,
  discountInputSchema,
  discountState,
  discountsService,
  type Discount,
} from "@/services/discounts";

const m = () => mock.current!;
const base = {
  code: "summer10",
  type: "percent" as const,
  value: "10",
  min_subtotal: "",
  max_uses: "",
  starts_at: "",
  ends_at: "",
  is_active: true,
};

beforeEach(() => m().reset());

describe("discount validation", () => {
  it("uppercases the code and turns blanks into null", () => {
    expect(discountInputSchema.parse(base)).toEqual({
      code: "SUMMER10",
      type: "percent",
      value: 10,
      min_subtotal: null,
      max_uses: null,
      starts_at: null,
      ends_at: null,
      is_active: true,
    });
  });
  it.each(["ab", "with space", "ÉTÉ10", "x".repeat(33), "semi;colon"])("rejects code %j", (code) =>
    expect(discountInputSchema.safeParse({ ...base, code }).success).toBe(false),
  );
  it("accepts dashes, underscores and digits", () =>
    expect(discountInputSchema.parse({ ...base, code: "eid-2026_x" }).code).toBe("EID-2026_X"));
  it("percent must be 1–100; fixed must be > 0", () => {
    const bad = (patch: object) => discountInputSchema.safeParse({ ...base, ...patch }).success;
    expect(bad({ value: "0" })).toBe(false);
    expect(bad({ value: "101" })).toBe(false);
    expect(bad({ value: "100" })).toBe(true);
    expect(bad({ type: "fixed", value: "0" })).toBe(false);
    expect(bad({ type: "fixed", value: "0.5" })).toBe(true);
    expect(bad({ value: "" })).toBe(false);
  });
  it("checks limits and dates", () => {
    const ok = (patch: object) => discountInputSchema.safeParse({ ...base, ...patch }).success;
    expect(ok({ max_uses: "0" })).toBe(false);
    expect(ok({ max_uses: "2.5" })).toBe(false);
    expect(ok({ min_subtotal: "-1" })).toBe(false);
    expect(ok({ starts_at: "2026-12-10T10:00", ends_at: "2026-12-01T10:00" })).toBe(false);
    expect(ok({ starts_at: "2026-12-01T10:00", ends_at: "2026-12-10T10:00" })).toBe(true);
  });
  it("is idempotent (service re-parses form output)", () => {
    const once = discountInputSchema.parse({ ...base, starts_at: "2026-12-01T10:00" });
    expect(discountInputSchema.parse(once)).toEqual(once);
  });
});

describe("discountsService", () => {
  it("lists a store's codes with numeric values", async () => {
    m().state.queue.push({
      data: [
        {
          id: "d1",
          store_id: "s1",
          code: "A10",
          type: "fixed",
          value: "5.50",
          min_subtotal: "20",
          max_uses: 3,
          used_count: 1,
          starts_at: null,
          ends_at: null,
          is_active: true,
          created_at: "x",
        },
      ],
    });
    const list = await discountsService.list("s1");
    expect(list[0]).toMatchObject({ value: 5.5, min_subtotal: 20 });
    expect(m().callsOn("discount_codes")).toContainEqual(["eq", "store_id", "s1"]);
  });

  it("create sends only the allowed columns (never used_count)", async () => {
    await discountsService.create("s1", { ...base, max_uses: "50" });
    const insert = m()
      .callsOn("discount_codes")
      .find(([k]) => k === "insert");
    expect(insert?.[1]).toEqual({
      store_id: "s1",
      code: "SUMMER10",
      type: "percent",
      value: 10,
      min_subtotal: null,
      max_uses: 50,
      starts_at: null,
      ends_at: null,
      is_active: true,
    });
  });

  it("update never sends store_id or used_count", async () => {
    m().state.queue.push({ data: [{ id: "d1" }] });
    await discountsService.update("d1", base);
    const update = m()
      .callsOn("discount_codes")
      .find(([k]) => k === "update");
    const payload = update?.[1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty("store_id");
    expect(payload).not.toHaveProperty("used_count");
    expect(m().callsOn("discount_codes")).toContainEqual(["eq", "id", "d1"]);
  });

  it("update/toggle/delete fail loudly when RLS matched no row", async () => {
    await expect(discountsService.update("d1", base)).rejects.toMatchObject({ code: "42501" });
    await expect(discountsService.setActive("d1", false)).rejects.toMatchObject({ code: "42501" });
    await expect(discountsService.remove("d1")).rejects.toMatchObject({ code: "42501" });
  });

  it("toggles is_active only", async () => {
    m().state.queue.push({ data: [{ id: "d1" }] });
    await discountsService.setActive("d1", false);
    expect(m().callsOn("discount_codes")).toContainEqual(["update", { is_active: false }]);
  });

  it("deletes by id", async () => {
    m().state.queue.push({ data: [{ id: "d1" }] });
    await discountsService.remove("d1");
    expect(m().callsOn("discount_codes")[0]?.[0]).toBe("delete");
    expect(m().callsOn("discount_codes")).toContainEqual(["eq", "id", "d1"]);
  });

  it("maps a duplicate code (23505) to a clear message", async () => {
    m().state.queue.push({ error: { code: "23505", message: "duplicate key" } });
    const err = await discountsService.create("s1", base).catch((e: unknown) => e);
    expect(discountError(err)).toBe("This code already exists in your store");
  });

  it("does not call the database for invalid input", async () => {
    await expect(discountsService.create("s1", { ...base, value: "500" })).rejects.toThrow();
    expect(m().state.queries).toEqual([]);
  });
});

describe("discountState", () => {
  const d = (patch: Partial<Discount>): Discount => ({
    id: "d",
    store_id: "s",
    code: "C",
    type: "percent",
    value: 10,
    min_subtotal: null,
    max_uses: null,
    used_count: 0,
    starts_at: null,
    ends_at: null,
    is_active: true,
    created_at: "",
    ...patch,
  });
  const now = Date.parse("2026-11-12T12:00:00Z");
  it("labels each state", () => {
    expect(discountState(d({}), now)).toBe("Active");
    expect(discountState(d({ is_active: false }), now)).toBe("Disabled");
    expect(discountState(d({ max_uses: 2, used_count: 2 }), now)).toBe("Used up");
    expect(discountState(d({ starts_at: "2026-12-01T00:00:00Z" }), now)).toBe("Scheduled");
    expect(discountState(d({ ends_at: "2026-11-01T00:00:00Z" }), now)).toBe("Expired");
  });
});
