import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { createSupabaseMock } from "./supabase-mock";
import { WithLocale } from "./i18n";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

import {
  addOption,
  brandSchema,
  colorsSchema,
  missingMessageKey,
  missingOptions,
  normalizeOptions,
  sizesSchema,
  validSelection,
} from "@/lib/product-options";
import { decodeCart, encodeCart, createLocalCartStorage } from "@/lib/cartStorage";
import { parseBuyNowSearch } from "@/lib/buy-now";
import { errorKey } from "@/i18n/messages";
import { lineMax, normalizeCart, updateCart, type CartItem } from "@/services/cart";
import { checkoutService, toOrderItems } from "@/services/checkout";
import { matchOptions, optionFacets } from "@/services/catalog";
import { productInputSchema } from "@/services/seller";
import { OptionPicker, SelectedOptions } from "@/components/marketplace/product-options";
import { OptionChips } from "@/components/seller/option-chips";

const m = () => mock.current!;
const TEE = { id: "tee", stock: 5, price: 20, colors: ["Black", "White"], sizes: ["S", "M", "L"] };
const MUG = { id: "mug", stock: 3, price: 9, colors: [], sizes: [] };
const PRODUCTS = [TEE, MUG];

beforeEach(() => {
  m().reset();
  m().state.session = { user: { id: "u1" } };
});

// ---------------------------------------------------------------------------
// Seller input: normalization and validation (the database's limits)
// ---------------------------------------------------------------------------
describe("option lists: normalization", () => {
  it("trims, collapses spaces, drops blanks and case-insensitive duplicates (first wins)", () => {
    expect(
      normalizeOptions(["  Light   blue ", "black", "Black", "", "BLACK", "Red"], "color"),
    ).toEqual(["Light blue", "black", "Red"]);
  });

  it("keeps the database limits: colors 20 × 30 chars, sizes 30 × 20 chars", () => {
    expect(
      normalizeOptions(
        Array.from({ length: 25 }, (_, i) => `c${i}`),
        "color",
      ),
    ).toHaveLength(20);
    expect(
      normalizeOptions(
        Array.from({ length: 40 }, (_, i) => `s${i}`),
        "size",
      ),
    ).toHaveLength(30);
    expect(normalizeOptions(["x".repeat(31), "ok"], "color")).toEqual(["ok"]);
    expect(normalizeOptions(["x".repeat(21), "M"], "size")).toEqual(["M"]);
  });

  it("adding chips: Enter/comma values, duplicates and limits are refused with a reason", () => {
    expect(addOption([], "S, M ,L", "size")).toEqual({ ok: true, list: ["S", "M", "L"] });
    expect(addOption(["Black"], "black", "color")).toMatchObject({
      ok: false,
      reason: "duplicate",
    });
    expect(addOption([], "x".repeat(31), "color")).toMatchObject({ ok: false, reason: "tooLong" });
    expect(addOption([], "  ", "color")).toMatchObject({ ok: false, reason: "empty" });
    const full = Array.from({ length: 20 }, (_, i) => `c${i}`);
    expect(addOption(full, "Pink", "color")).toMatchObject({
      ok: false,
      reason: "full",
      list: full,
    });
  });

  it("zod: brand 1–80 or null; colors/sizes within limits and unique", () => {
    expect(brandSchema.parse("  Nike ")).toBe("Nike");
    expect(brandSchema.parse("")).toBeNull();
    expect(brandSchema.parse(undefined)).toBeNull();
    expect(brandSchema.safeParse("x".repeat(81)).success).toBe(false);
    expect(colorsSchema.parse([" Black ", ""])).toEqual(["Black"]);
    expect(colorsSchema.parse(undefined)).toEqual([]);
    expect(colorsSchema.safeParse(["Black", "black"]).success).toBe(false);
    expect(colorsSchema.safeParse(["x".repeat(31)]).success).toBe(false);
    expect(colorsSchema.safeParse(Array.from({ length: 21 }, (_, i) => `c${i}`)).success).toBe(
      false,
    );
    expect(sizesSchema.safeParse(["x".repeat(21)]).success).toBe(false);
    expect(sizesSchema.safeParse(Array.from({ length: 31 }, (_, i) => `s${i}`)).success).toBe(
      false,
    );
  });

  it("the product form saves brand, colors and sizes", () => {
    const parsed = productInputSchema.parse({
      title: "T-shirt",
      slug: "t-shirt",
      description: "",
      price: "20",
      compare_price: "",
      stock: "5",
      category_id: "6f1c2b0a-4d3e-4f5a-9b8c-7d6e5f4a3b2c",
      status: "draft",
      brand: " Nike ",
      colors: ["Black", "White"],
      sizes: ["S", "M"],
    });
    expect(parsed).toMatchObject({ brand: "Nike", colors: ["Black", "White"], sizes: ["S", "M"] });
    // The save builds the row from these values (`{ ...values, slug, featured_image }`).
    expect(readFileSync(join(process.cwd(), "src/services/seller.ts"), "utf8")).toContain(
      "const row = { ...values, slug: s, featured_image: urls[0] ?? null };",
    );
  });
});

// ---------------------------------------------------------------------------
// The buyer's selection
// ---------------------------------------------------------------------------
describe("selection", () => {
  it("required choices, exact values only", () => {
    expect(missingOptions(TEE, {})).toEqual(["color", "size"]);
    expect(missingOptions(TEE, { color: "Black" })).toEqual(["size"]);
    expect(missingOptions(TEE, { color: "black", size: "M" })).toEqual(["color"]); // exact match
    expect(missingOptions(MUG, {})).toEqual([]);
    expect(validSelection(TEE, { color: "Black", size: "M" })).toEqual({
      color: "Black",
      size: "M",
    });
    expect(validSelection(TEE, { color: "Pink", size: "M" })).toBeNull();
    expect(validSelection(MUG, { color: "Black" })).toBeNull(); // no such option
    expect(validSelection(MUG, {})).toEqual({ color: null, size: null });
    expect(missingMessageKey(["color", "size"])).toBe("options.chooseBoth");
    expect(missingMessageKey(["size"])).toBe("options.chooseSize");
  });
});

// ---------------------------------------------------------------------------
// Cart lines: product + color + size
// ---------------------------------------------------------------------------
describe("cart lines", () => {
  const black = { productId: "tee", color: "Black", size: "M" };
  const white = { productId: "tee", color: "White", size: "M" };

  it("another color is another line; the same choice adds up", () => {
    let cart: CartItem[] = [];
    cart = updateCart(cart, black, 1, PRODUCTS);
    cart = updateCart(cart, white, 1, PRODUCTS);
    cart = updateCart(cart, black, 2, PRODUCTS); // set this line to 2
    expect(cart).toEqual([
      { productId: "tee", quantity: 2, color: "Black", size: "M" },
      { productId: "tee", quantity: 1, color: "White", size: "M" },
    ]);
  });

  it("stock is shared by all colors and sizes of the product", () => {
    let cart = updateCart([], black, 4, PRODUCTS);
    expect(lineMax(cart, white, TEE.stock)).toBe(1);
    cart = updateCart(cart, white, 3, PRODUCTS);
    expect(cart.find((i) => i.color === "White")?.quantity).toBe(1);
    expect(cart.reduce((s, i) => s + i.quantity, 0)).toBe(5);
  });

  it("a missing or unknown choice is never added", () => {
    expect(updateCart([], { productId: "tee" }, 1, PRODUCTS)).toEqual([]);
    expect(updateCart([], { productId: "tee", color: "Pink", size: "M" }, 1, PRODUCTS)).toEqual([]);
  });

  it("plain products behave as before", () => {
    expect(updateCart([], "mug", 2, PRODUCTS)).toEqual([{ productId: "mug", quantity: 2 }]);
    expect(updateCart([{ productId: "mug", quantity: 2 }], "mug", 0, PRODUCTS)).toEqual([]);
  });

  it("restoring: merges equal lines, drops choices the product no longer has, caps stock", () => {
    expect(
      normalizeCart(
        [
          { productId: "tee", quantity: 3, color: "Black", size: "M" },
          { productId: "tee", quantity: 1, color: "Black", size: "M" },
          { productId: "tee", quantity: 9, color: "White", size: "L" },
          { productId: "tee", quantity: 1, color: "Pink", size: "M" },
          { productId: "tee", quantity: 1 },
          { productId: "mug", quantity: 1, color: "Red" },
          { productId: "mug", quantity: 2 },
        ],
        PRODUCTS,
      ),
    ).toEqual([
      { productId: "tee", quantity: 4, color: "Black", size: "M" },
      { productId: "tee", quantity: 1, color: "White", size: "L" },
      { productId: "mug", quantity: 2 },
    ]);
  });

  it("the shared cookie keeps color and size, even with ':' or '|' in them", () => {
    const items = [
      { productId: "tee", quantity: 2, color: "Black: matte", size: "M|L" },
      { productId: "mug", quantity: 1 },
    ];
    const encoded = encodeCart(items);
    expect(decodeURIComponent(encoded)).toContain("mug:1"); // plain lines keep the old form
    expect(decodeCart(encoded)).toEqual(items);
    // Carts saved by the previous version still load.
    expect(decodeCart(encodeURIComponent("tee:2|mug:1"))).toEqual([
      { productId: "tee", quantity: 2 },
      { productId: "mug", quantity: 1 },
    ]);
    expect(decodeCart(encodeURIComponent("tee:2:x"))).toEqual([]);
  });

  it("localStorage keeps color and size too", () => {
    const store = new Map<string, string>();
    const local = createLocalCartStorage({
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k),
    });
    local.save([{ productId: "tee", quantity: 1, color: "Black", size: "S" }]);
    expect(local.load()).toEqual([{ productId: "tee", quantity: 1, color: "Black", size: "S" }]);
  });
});

// ---------------------------------------------------------------------------
// Placing the order: the choice goes to place_order, which checks it
// ---------------------------------------------------------------------------
describe("order items and server validation", () => {
  it("one entry per line with the choice; equal lines merged", () => {
    expect(
      toOrderItems([
        { productId: "tee", quantity: 1, color: "Black", size: "M" },
        { productId: "tee", quantity: 2, color: "Black", size: "M" },
        { productId: "tee", quantity: 1, color: "White", size: "M" },
        { productId: "mug", quantity: 1 },
      ]),
    ).toEqual([
      { product_id: "tee", quantity: 3, selected_color: "Black", selected_size: "M" },
      { product_id: "tee", quantity: 1, selected_color: "White", selected_size: "M" },
      { product_id: "mug", quantity: 1, selected_color: null, selected_size: null },
    ]);
  });

  it("place_order receives the choice; its refusal is shown, translated", async () => {
    const refusal = {
      message: "Please choose a valid color and size for each item",
      code: "P0001",
    };
    m().state.queue.push({ error: refusal });
    await expect(
      checkoutService.placeOrder(
        [{ productId: "tee", quantity: 1, color: "Pink", size: "M" }],
        {
          full_name: "Ada Lovelace",
          phone: "+358 40 123 4567",
          email: "ada@example.com",
          country: "Finland",
          city: "Helsinki",
          address: "Main street 1",
          notes: "",
        },
        "cod",
      ),
    ).rejects.toMatchObject(refusal);
    const call = m().state.rpcs.find((r) => r.fn === "place_order");
    expect((call?.args as { p_items: unknown }).p_items).toEqual([
      { product_id: "tee", quantity: 1, selected_color: "Pink", selected_size: "M" },
    ]);
    expect(errorKey(refusal)).toBe("checkout.invalidOptions");
  });

  it("Buy now carries the choice in the address (within the database limits)", () => {
    expect(parseBuyNowSearch({ buy: "tee", qty: "2", color: "Black", size: "M" })).toEqual({
      buy: "tee",
      qty: 2,
      color: "Black",
      size: "M",
    });
    expect(parseBuyNowSearch({ buy: "tee", color: "x".repeat(31), size: "   " })).toEqual({
      buy: "tee",
    });
  });

  it("the Stripe page lists each item with its color and size", () => {
    const fn = readFileSync(
      join(process.cwd(), "supabase/functions/create-checkout-session/index.ts"),
      "utf8",
    );
    expect(fn).toContain("order_items(title, quantity, selected_color, selected_size)");
    expect(fn).toContain("Color: ${i.selected_color}");
  });
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
describe("brand / color / size filters", () => {
  const list = [
    { id: "1", brand: "Nike", colors: ["Black", "Red"], sizes: ["S", "M"] },
    { id: "2", brand: "nike", colors: ["White"], sizes: ["L"] },
    { id: "3", brand: null, colors: [], sizes: [] },
  ];
  it("case-insensitive matching", () => {
    expect(matchOptions(list, { brand: "NIKE" }).map((p) => p.id)).toEqual(["1", "2"]);
    expect(matchOptions(list, { color: "red" }).map((p) => p.id)).toEqual(["1"]);
    expect(matchOptions(list, { size: "l" }).map((p) => p.id)).toEqual(["2"]);
    expect(matchOptions(list, {}).map((p) => p.id)).toEqual(["1", "2", "3"]);
  });
  it("facets: each value once", () => {
    expect(optionFacets(list)).toEqual({
      brands: ["Nike"],
      colors: ["Black", "Red", "White"],
      sizes: ["S", "M", "L"],
    });
  });
});

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------
function Picker() {
  const [value, setValue] = useState<string | null>(null);
  return (
    <WithLocale>
      <OptionPicker kind="size" values={["S", "M", "L"]} value={value} onChange={setValue} />
    </WithLocale>
  );
}

describe("UI", () => {
  it("the picker is a keyboard radio group with the choice highlighted", () => {
    render(<Picker />);
    const group = screen.getByRole("radiogroup", { name: "Size" });
    const [s, m2] = screen.getAllByRole("radio");
    expect(group).toHaveAttribute("aria-required", "true");
    expect(s).toHaveAttribute("tabindex", "0");
    fireEvent.click(m2!);
    expect(m2).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(m2!, { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "L" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "L" })).toHaveAttribute("tabindex", "0");
  });

  it("the chosen options under an item, translated", () => {
    render(
      <WithLocale locale="de">
        <SelectedOptions color="Schwarz" size="M" />
      </WithLocale>,
    );
    expect(screen.getByTestId("selected-options")).toHaveTextContent("Farbe: Schwarz · Größe: M");
  });

  it("seller chips: Enter and comma add, duplicates are refused, × removes", () => {
    function Chips() {
      const [values, setValues] = useState<string[]>(["Black"]);
      return (
        <OptionChips
          kind="color"
          label="Colors"
          values={values}
          onChange={setValues}
          suggestions={["White"]}
        />
      );
    }
    render(<Chips />);
    const input = screen.getByLabelText("Colors");
    fireEvent.change(input, { target: { value: "Red" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("Red")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "black," } });
    expect(screen.getByRole("alert")).toHaveTextContent("That color is already in the list.");
    fireEvent.click(screen.getByRole("button", { name: "Remove Red" }));
    expect(screen.queryByText("Red")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "White" })); // a quick suggestion
    expect(screen.getByRole("list", { name: /Colors/ })).toHaveTextContent("White");
  });

  it("product page and card: a choice is required before adding (source check)", () => {
    const page = readFileSync(join(process.cwd(), "src/routes/product.$id.tsx"), "utf8");
    expect(page).toContain("if (chosen()) add(p.id, quantity, { color, size });");
    expect(page).toMatch(/if \(leavingRef\.current \|\| p\.stock < 1 \|\| !chosen\(\)\) return;/);
    const card = readFileSync(join(process.cwd(), "src/components/marketplace/shared.tsx"), "utf8");
    expect(card).toContain("hasOptions(product) ?");
  });
});
