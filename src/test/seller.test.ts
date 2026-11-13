import { describe, expect, it } from "vitest";
import {
  friendlyError,
  MAX_IMAGE_BYTES,
  productInputSchema,
  slugify,
  storeInputSchema,
  validateImage,
} from "@/services/seller";

const validProduct = {
  title: "Desk Fan",
  slug: "desk-fan",
  description: "",
  price: "14.99",
  compare_price: "",
  stock: "5",
  category_id: "dc482a9f-5dbc-4a38-8c96-ba2d6e8f9071",
  status: "draft",
};

describe("slugify", () => {
  it("makes URL-safe slugs", () => {
    expect(slugify("Portable USB Fan – 3 Speed & LED!")).toBe("portable-usb-fan-3-speed-led");
    expect(slugify("  Café Crème  ")).toBe("cafe-creme");
    expect(slugify("---")).toBe("");
  });
  it("caps length without a trailing hyphen", () => {
    const s = slugify("word ".repeat(40));
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith("-")).toBe(false);
  });
});

describe("product validation", () => {
  it("coerces form strings and empties", () => {
    const v = productInputSchema.parse(validProduct);
    expect(v).toMatchObject({ price: 14.99, stock: 5, compare_price: null, description: null });
  });
  it("requires compare price above price", () => {
    const r = productInputSchema.safeParse({ ...validProduct, compare_price: "10" });
    expect(r.success).toBe(false);
    expect(r.error?.flatten().fieldErrors.compare_price).toBeDefined();
  });
  it("rejects bad slugs, negative stock, fractional stock and missing category", () => {
    for (const patch of [
      { slug: "Bad Slug" },
      { stock: "-1" },
      { stock: "1.5" },
      { category_id: "" },
      { price: "0" },
      { status: "published" },
    ])
      expect(productInputSchema.safeParse({ ...validProduct, ...patch }).success).toBe(false);
  });
});

describe("store validation", () => {
  it("trims and nulls optional fields", () =>
    expect(
      storeInputSchema.parse({
        name: " Shop ",
        slug: "my-shop",
        description: " ",
        category: "",
        location: "",
      }),
    ).toEqual({
      name: "Shop",
      slug: "my-shop",
      description: null,
      category: null,
      location: null,
    }));
  it("requires a name", () =>
    expect(
      storeInputSchema.safeParse({ name: "a", slug: "my-shop", description: "" }).success,
    ).toBe(false));
  it("requires a store address", () =>
    expect(storeInputSchema.safeParse({ name: "Shop" }).success).toBe(false));
});

describe("uploads", () => {
  const file = (type: string, size: number) => new File([new Uint8Array(size)], "x", { type });
  it("accepts images up to 5 MB only", () => {
    expect(() => validateImage(file("image/png", 1000))).not.toThrow();
    expect(() => validateImage(file("image/png", MAX_IMAGE_BYTES + 1))).toThrow(/5 MB/);
    expect(() => validateImage(file("application/pdf", 10))).toThrow(/PNG/);
    expect(() => validateImage(file("image/svg+xml", 10))).toThrow();
  });
});

describe("friendlyError", () => {
  it("explains common database errors", () => {
    expect(friendlyError({ code: "23505" })).toMatch(/slug/);
    expect(friendlyError({ code: "23503" })).toMatch(/draft/);
    expect(friendlyError({ message: "new row violates row-level security policy" })).toMatch(
      /permission/,
    );
  });
});
