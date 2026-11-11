import { beforeEach, describe, expect, it, vi } from "vitest";

// Records every write the service makes, instead of talking to Supabase.
const db = vi.hoisted(() => ({
  writes: [] as { table: string; op: string; payload?: unknown }[],
}));

vi.mock("@/lib/supabase", () => {
  const builder = (table: string) => {
    const result: { data: unknown[]; error: null } = { data: [], error: null };
    const write = (op: string, payload?: unknown) => {
      db.writes.push({ table, op, payload });
      if (op !== "insert") result.data = [{ id: "row" }]; // update/delete "matched" a row
      return b;
    };
    const b: Record<string, unknown> = {
      select: () => b,
      like: () => b,
      eq: () => b,
      in: () => b,
      order: () => b,
      insert: (p: unknown) => write("insert", p),
      update: (p: unknown) => write("update", p),
      delete: () => write("delete"),
      // .single() resolves to the written row, like PostgREST's `return=representation`.
      single: async () => ({
        data: [...db.writes].reverse().find((w) => w.table === table)?.payload ?? null,
        error: null,
      }),
      then: (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
        Promise.resolve(result).then(ok, fail),
    };
    return b;
  };
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
      from: builder,
      storage: {
        from: (bucket: string) => ({
          upload: async (path: string) => {
            db.writes.push({ table: `storage:${bucket}`, op: "upload", payload: path });
            return { error: null };
          },
          getPublicUrl: (path: string) => ({
            data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${path}` },
          }),
          remove: async () => ({ error: null }),
        }),
      },
    },
  };
});

import {
  productInputSchema,
  sellerService,
  storeInputSchema,
  type SellerProduct,
} from "@/services/seller";

const STORE = "11111111-1111-4111-8111-111111111111";
const formValues = {
  title: "Desk Fan",
  slug: "desk-fan",
  description: "",
  price: "14.99",
  compare_price: "",
  stock: "5",
  category_id: "dc482a9f-5dbc-4a38-8c96-ba2d6e8f9071",
  status: "draft",
};
type Payload = { description?: unknown; featured_image?: unknown; [key: string]: unknown };
const productInsert = () =>
  db.writes.find((w) => w.table === "products" && w.op === "insert")?.payload as
    Payload | undefined;

beforeEach(() => {
  db.writes.length = 0;
});

describe("saveProduct", () => {
  it("saves a product with no description (stored as null)", async () => {
    // Exactly what the form does: parse once, then hand the parsed values to the service.
    const parsed = productInputSchema.parse(formValues);
    await expect(sellerService.saveProduct(STORE, parsed, [])).resolves.toBeUndefined();
    expect(productInsert()).toMatchObject({
      title: "Desk Fan",
      description: null,
      compare_price: null,
      price: 14.99,
      stock: 5,
      featured_image: null,
      store_id: STORE,
    });
  });

  it("stores a whitespace-only description as null", async () => {
    const parsed = productInputSchema.parse({ ...formValues, description: "   " });
    await sellerService.saveProduct(STORE, parsed, []);
    expect(productInsert()?.description).toBeNull();
  });

  it("clears a description when editing", async () => {
    const existing = {
      id: "22222222-2222-4222-8222-222222222222",
      store_id: STORE,
      description: "Old text",
      featured_image: null,
      product_images: [],
    } as unknown as SellerProduct;
    await sellerService.saveProduct(STORE, productInputSchema.parse(formValues), [], existing);
    const update = db.writes.find((w) => w.table === "products" && w.op === "update");
    expect((update?.payload as Payload).description).toBeNull();
  });

  it("uploads new images under the user's folder and sets the cover", async () => {
    const file = new File([new Uint8Array(10)], "a.png", { type: "image/png" });
    await sellerService.saveProduct(STORE, productInputSchema.parse(formValues), [
      { kind: "new", key: "k", file, preview: "blob:x" },
    ]);
    const upload = db.writes.find((w) => w.op === "upload");
    expect(upload?.payload).toMatch(
      new RegExp(`^user-1/products/${STORE}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.png$`),
    );
    expect(productInsert()?.featured_image).toMatch(/product-images\/user-1\//);
    const images = db.writes.find((w) => w.table === "product_images" && w.op === "insert");
    expect(images?.payload).toEqual([
      expect.objectContaining({ sort_order: 0, image_url: productInsert()?.featured_image }),
    ]);
  });
});

describe("optional fields", () => {
  it("product schema accepts its own output (idempotent)", () => {
    for (const input of [
      formValues,
      { ...formValues, description: "Nice fan", compare_price: "19.99" },
    ]) {
      const once = productInputSchema.parse(input);
      expect(productInputSchema.parse(once)).toEqual(once);
    }
  });

  it("treats blank and null compare_price the same", () => {
    for (const compare_price of ["", "  ", null, undefined])
      expect(productInputSchema.parse({ ...formValues, compare_price }).compare_price).toBeNull();
  });

  it("rejects empty price and stock instead of saving 0", () => {
    const r = productInputSchema.safeParse({ ...formValues, price: "", stock: "" });
    expect(r.success).toBe(false);
    const errors = r.error?.flatten().fieldErrors;
    expect(errors?.price).toEqual(["Enter a price."]);
    expect(errors?.stock).toEqual(["Enter the stock quantity."]);
    expect(productInputSchema.parse({ ...formValues, stock: "0" }).stock).toBe(0);
  });

  it("store schema nulls blank description, category and location, and is idempotent", () => {
    const once = storeInputSchema.parse({
      name: "Shop",
      description: "",
      category: "  ",
      location: null,
    });
    expect(once).toEqual({ name: "Shop", description: null, category: null, location: null });
    expect(storeInputSchema.parse(once)).toEqual(once);
    expect(storeInputSchema.parse({ name: "Shop" })).toEqual({
      name: "Shop",
      description: null,
      category: null,
      location: null,
    });
  });
});

describe("store saves", () => {
  it("creates a draft store with blank optional fields as null", async () => {
    await sellerService.createStore(
      { name: "My Shop", description: "", category: "", location: "" },
      {},
    );
    const insert = db.writes.find((w) => w.table === "stores" && w.op === "insert");
    expect(insert?.payload).toMatchObject({
      name: "My Shop",
      slug: "my-shop",
      description: null,
      category: null,
      location: null,
      status: "draft",
      owner_id: "user-1",
      logo_url: null,
      banner_url: null,
    });
  });
});
