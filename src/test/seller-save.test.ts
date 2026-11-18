import { beforeEach, describe, expect, it, vi } from "vitest";
// Photos are shrunk before upload; jsdom has no canvas encoder (see ./fake-image).
vi.mock("@/lib/image-optimize", async (orig) =>
  (await import("./fake-image")).withFakeCodec(await orig<typeof import("@/lib/image-optimize")>()),
);

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
  storeError,
  storeInputSchema,
  storeSlugSchema,
  toStoreSlug,
  type SellerProduct,
} from "@/services/seller";
import { isValidStoreSlug, RESERVED_STORE_SLUGS } from "@/lib/host";

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
    // The shrunk photo and its thumbnail; never the original file.
    const uploads = db.writes.filter((w) => w.op === "upload").map((w) => String(w.payload));
    expect(uploads).toEqual([
      expect.stringMatching(
        new RegExp(`^user-1/products/${STORE}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.thumb\\.webp$`),
      ),
      expect.stringMatching(
        new RegExp(`^user-1/products/${STORE}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.opt\\.webp$`),
      ),
    ]);
    expect(productInsert()?.featured_image).toMatch(/product-images\/user-1\/.*\.opt\.webp$/);
    const images = db.writes.find((w) => w.table === "product_images" && w.op === "insert");
    expect(images?.payload).toEqual([
      expect.objectContaining({ sort_order: 0, image_url: productInsert()?.featured_image }),
    ]);
  });
});

describe("editing keeps every image", () => {
  it("5 saved images (first = cover) stay 5, in order, cover first, none duplicated", async () => {
    const url = (n: number) =>
      `https://x.supabase.co/storage/v1/object/public/product-images/p/${n}.jpg`;
    const existing = {
      id: "22222222-2222-4222-8222-222222222222",
      store_id: STORE,
      featured_image: url(0),
      product_images: [0, 1, 2, 3, 4].map((n) => ({
        id: `img-${n}`,
        product_id: "22222222-2222-4222-8222-222222222222",
        image_url: url(n),
        sort_order: n,
      })),
    } as unknown as SellerProduct;
    // What the form sends for that product: the five existing URLs, unchanged.
    const images = [0, 1, 2, 3, 4].map((n) => ({
      kind: "existing" as const,
      key: url(n),
      url: url(n),
    }));
    await sellerService.saveProduct(STORE, productInputSchema.parse(formValues), images, existing);
    const update = db.writes.find((w) => w.table === "products" && w.op === "update");
    expect((update?.payload as Payload).featured_image).toBe(url(0));
    const inserted = db.writes.find((w) => w.table === "product_images" && w.op === "insert")
      ?.payload as { image_url: string; sort_order: number }[];
    expect(inserted.map((r) => [r.sort_order, r.image_url])).toEqual(
      [0, 1, 2, 3, 4].map((n) => [n, url(n)]),
    );
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
      slug: " My-Shop ",
      description: "",
      category: "  ",
      location: null,
    });
    expect(once).toEqual({
      name: "Shop",
      slug: "my-shop",
      description: null,
      category: null,
      location: null,
    });
    expect(storeInputSchema.parse(once)).toEqual(once);
    expect(storeInputSchema.parse({ name: "Shop", slug: "my-shop" })).toEqual({
      name: "Shop",
      slug: "my-shop",
      description: null,
      category: null,
      location: null,
    });
  });
});

describe("store saves", () => {
  it("creates a draft store with blank optional fields as null", async () => {
    await sellerService.createStore(
      { name: "My Shop", slug: "my-shop", description: "", category: "", location: "" },
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

  it("uses the seller's chosen address and never renames it", async () => {
    await sellerService.createStore({ name: "My Shop", slug: "best-shop-kabul" }, {});
    const insert = db.writes.find((w) => w.table === "stores" && w.op === "insert");
    expect((insert?.payload as Payload)["slug"]).toBe("best-shop-kabul");
    expect(db.writes.filter((w) => w.table === "stores" && w.op === "insert")).toHaveLength(1);
  });

  it("rejects an invalid or reserved address before calling the database", async () => {
    for (const slug of ["ab", "-shop", "shop-", "my shop!", "admin", "www", "x".repeat(64)])
      await expect(sellerService.createStore({ name: "My Shop", slug }, {})).rejects.toThrow();
    expect(db.writes.filter((w) => w.table === "stores")).toEqual([]);
  });
});

describe("reserved store addresses", () => {
  const EXPECTED = [
    "www",
    "app",
    "admin",
    "api",
    "seller",
    "sellers",
    "store",
    "stores",
    "shop",
    "shops",
    "mail",
    "email",
    "smtp",
    "imap",
    "ftp",
    "cdn",
    "static",
    "assets",
    "img",
    "images",
    "help",
    "support",
    "blog",
    "status",
    "dev",
    "test",
    "staging",
    "checkout",
    "cart",
    "account",
    "login",
    "signup",
    "auth",
    "billing",
    "pay",
    "payments",
    "docs",
    "saloree",
    "ns1",
    "ns2",
    "dashboard",
    "root",
    "secure",
  ];
  const msg = (slug: string) => storeSlugSchema.safeParse(slug).error?.issues[0]?.message;

  it("is exactly the agreed list (one shared constant)", () => {
    expect([...RESERVED_STORE_SLUGS]).toEqual(EXPECTED);
  });

  it.each(EXPECTED)("the form rejects %j before saving", (slug) => {
    expect(msg(slug)).toBe("That address is reserved. Choose another.");
    expect(msg(slug.toUpperCase())).toBe("That address is reserved. Choose another.");
    expect(isValidStoreSlug(slug)).toBe(false);
  });

  it("only blocks exact matches, not addresses that merely contain a reserved word", () => {
    for (const ok of ["shop-kabul", "my-store", "helpful-home", "testing-lab", "saloree-fans"])
      expect(storeSlugSchema.safeParse(ok).success).toBe(true);
  });

  it("enforces the address rules", () => {
    expect(storeSlugSchema.safeParse("abc").success).toBe(true); // 3 chars
    expect(storeSlugSchema.safeParse("a".repeat(63)).success).toBe(true); // 63 chars
    expect(storeSlugSchema.safeParse("a1-b2").success).toBe(true);
    expect(msg("ab")).toMatch(/at least 3/);
    expect(msg("a".repeat(64))).toMatch(/at most 63/);
    expect(msg("-abc")).toMatch(/dash/);
    expect(msg("abc-")).toMatch(/dash/);
    for (const bad of ["my_shop", "my shop", "my.shop", "café", "shop!"])
      expect(msg(bad)).toMatch(/lowercase letters/);
  });

  it("never reaches the database with a reserved address", async () => {
    await expect(
      sellerService.createStore({ name: "Help Desk", slug: "support" }, {}),
    ).rejects.toThrow();
    expect(db.writes.filter((w) => w.table === "stores")).toEqual([]);
  });
});

describe("store address rules", () => {
  const msg = (slug: string) => storeSlugSchema.safeParse(slug).error?.issues[0]?.message;
  it("accepts DNS-safe addresses and lowercases", () => {
    expect(storeSlugSchema.parse("NextGen-Tech")).toBe("nextgen-tech");
    expect(storeSlugSchema.parse("abc")).toBe("abc");
    expect(storeSlugSchema.parse("a".repeat(63))).toHaveLength(63);
  });
  it("explains each problem", () => {
    expect(msg("ab")).toMatch(/at least 3/);
    expect(msg("a".repeat(64))).toMatch(/at most 63/);
    expect(msg("-abc")).toMatch(/start or end with a dash/);
    expect(msg("abc-")).toMatch(/start or end with a dash/);
    expect(msg("my_shop")).toMatch(/lowercase letters/);
    expect(msg("café")).toMatch(/lowercase letters/);
    for (const r of ["www", "admin", "api", "app", "seller", "checkout"])
      expect(msg(r)).toMatch(/reserved/);
  });
  it("suggests an address from the store name", () => {
    expect(toStoreSlug("Kabul Fresh Market!")).toBe("kabul-fresh-market");
    expect(toStoreSlug("x".repeat(80))).toHaveLength(63);
  });
  it("maps the database's taken / reserved errors to clear messages", () => {
    expect(storeError({ code: "23505", message: "duplicate key" })).toMatch(/already taken/);
    expect(storeError({ code: "23514", message: "check violation" })).toMatch(/reserved/);
    expect(storeError({ code: "P0001", message: "Store slug is reserved" })).toBe(
      "Store slug is reserved",
    );
  });
});
