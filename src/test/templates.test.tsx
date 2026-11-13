import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";

const cart = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock("@/components/marketplace/cart-context", () => ({
  useCart: () => ({ add: cart.add, items: [], ready: true, setQuantity: vi.fn(), clear: vi.fn() }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import type { Category, Product, Store } from "@/data/catalog";
import {
  templateDataFromCatalog,
  templateDataFromSeller,
  type TemplateData,
} from "@/templates/data";
import { getTemplate, resolveTheme, TEMPLATES, type TemplateCode } from "@/templates/registry";
import { TemplateView } from "@/templates/render";
import {
  contrastRatio,
  contrastWarnings,
  diffFromDefaults,
  mergeSettings,
  SETTING_KEYS,
  themeCssVars,
  themeSettingsSchema,
  type ThemeSettings,
} from "@/templates/settings";
import { renderWithRouter } from "./router-harness";

const store: Store = {
  id: "s1",
  slug: "kabul-goods",
  name: "Kabul Goods",
  initials: "kg",
  description: "Hand-picked goods from Kabul.",
  rating: 0,
  specialty: "",
  image: "https://img.example/banner.jpg",
  tone: "sage",
  logo: "https://img.example/logo.png",
  banner: "https://img.example/banner.jpg",
};
const product = (i: number, extra: Partial<Product> = {}): Product => ({
  id: `p${i}`,
  title: `Product ${i}`,
  price: 10 + i,
  rating: 0,
  reviews: 0,
  storeSlug: "kabul-goods",
  category: i % 2 ? "home" : "fashion",
  image: `https://img.example/p${i}.jpg`,
  stock: i,
  description: `Description ${i}`,
  createdAt: i,
  ...extra,
});
const categories: Category[] = [
  { slug: "home", name: "Home", image: "https://img.example/home.jpg" },
  { slug: "fashion", name: "Fashion", image: "https://img.example/f.jpg" },
  { slug: "toys", name: "Toys", image: "" },
];
const data: TemplateData = {
  store,
  products: [1, 2, 3, 4, 5, 6].map((i) =>
    product(i, i === 2 ? { originalPrice: 30, badge: "Sale" } : {}),
  ),
  categories: categories.slice(0, 2),
};
const CODES = Object.keys(TEMPLATES) as TemplateCode[];

function render(code: TemplateCode, settings: ThemeSettings, mode: "live" | "preview", d = data) {
  return renderWithRouter(
    <TemplateView template={TEMPLATES[code]} settings={settings} data={d} mode={mode} />,
  );
}

// ---------------------------------------------------------------------------
describe("settings helpers", () => {
  const defaults = TEMPLATES.classic.defaults;

  it("every template's defaults contain every allowed key and validate", () => {
    for (const code of CODES) {
      const d = TEMPLATES[code].defaults;
      expect(Object.keys(d).sort(), code).toEqual([...SETTING_KEYS].sort());
      expect(themeSettingsSchema.safeParse(d).success, code).toBe(true);
    }
  });

  it("mergeSettings applies valid overrides and ignores unknown or invalid ones", () => {
    const merged = mergeSettings(defaults, {
      primary: "#123456",
      accent: "red", // invalid colour → default kept
      grid_columns: 5, // not allowed → default kept
      font_heading: "comic-sans", // not in the list → default kept
      evil: "url(javascript:alert(1))", // unknown key → ignored
      hero_title: "Welcome",
    });
    expect(merged.primary).toBe("#123456");
    expect(merged.accent).toBe(defaults.accent);
    expect(merged.grid_columns).toBe(defaults.grid_columns);
    expect(merged.font_heading).toBe(defaults.font_heading);
    expect(merged.hero_title).toBe("Welcome");
    expect(merged).not.toHaveProperty("evil");
    for (const junk of [null, "x", 42, [1, 2]])
      expect(mergeSettings(defaults, junk)).toEqual(defaults);
  });

  it("diffFromDefaults saves only what changed, and merging it back restores the settings", () => {
    const edited = { ...defaults, primary: "#000000", show_about: false };
    const diff = diffFromDefaults(defaults, edited);
    expect(diff).toEqual({ primary: "#000000", show_about: false });
    expect(mergeSettings(defaults, diff)).toEqual(edited);
    expect(diffFromDefaults(defaults, defaults)).toEqual({});
  });

  it("the schema is strict and validates every rule", () => {
    const ok = (patch: object) => themeSettingsSchema.safeParse({ ...defaults, ...patch }).success;
    expect(ok({ primary: "#A1b2C3" })).toBe(true);
    for (const bad of ["#FFF", "red", "#GGGGGG", "#1234567", "rgb(0,0,0)", "#000000;x:y"])
      expect(ok({ primary: bad }), bad).toBe(false);
    expect(ok({ extra_key: 1 })).toBe(false);
    expect(ok({ grid_columns: 5 })).toBe(false);
    expect(ok({ corner_style: "round" })).toBe(false);
    expect(ok({ hero_title: "x".repeat(81) })).toBe(false);
    expect(ok({ hero_subtitle: "x".repeat(201) })).toBe(false);
    expect(ok({ hero_cta_label: "x".repeat(31) })).toBe(false);
    expect(ok({ announcement_text: "x".repeat(121) })).toBe(false);
    expect(ok({ hero_image_url: "http://img.example/x.jpg" })).toBe(false);
    expect(ok({ hero_image_url: "javascript:alert(1)" })).toBe(false);
    expect(ok({ hero_image_url: "" })).toBe(true);
    expect(ok({ hero_image_url: "https://img.example/x.jpg" })).toBe(true);
  });

  it("CSS variables only ever carry validated values", () => {
    const vars = themeCssVars({ ...defaults, primary: "#000000;background:url(x)" as string });
    expect(vars["--tpl-primary"]).toBe("#1F4E4A"); // invalid colour never reaches CSS
    const ok = themeCssVars({
      ...defaults,
      font_heading: "playfair",
      corner_style: "pill",
      grid_columns: 2,
    });
    expect(ok["--tpl-font-heading"]).toContain("Playfair Display");
    expect(ok["--tpl-radius"]).toBe("999px");
    expect(ok["--tpl-grid-cols"]).toBe("2");
  });

  it("contrast checks follow WCAG", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBe(21);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
    expect(contrastRatio("red", "#FFFFFF")).toBeNull();
    for (const code of CODES) expect(contrastWarnings(TEMPLATES[code].defaults), code).toEqual([]);
    const low = contrastWarnings({ ...defaults, text: "#BBBBBB", background: "#FFFFFF" });
    expect(low.map((w) => w.pair)).toEqual(["Text on background"]);
  });
});

describe("registry", () => {
  it("unknown or inactive codes fall back to Classic", () => {
    expect(getTemplate("nope").code).toBe("classic");
    expect(getTemplate("boutique", false).code).toBe("classic");
    expect(getTemplate("boutique").code).toBe("boutique");
    expect(getTemplate("__proto__").code).toBe("classic");
  });
  it("a store without a saved theme uses Classic defaults", () => {
    const r = resolveTheme(null);
    expect(r.template.code).toBe("classic");
    expect(r.settings).toEqual(TEMPLATES.classic.defaults);
  });
  it("saved overrides apply over the saved template's own defaults", () => {
    const r = resolveTheme({ code: "market", isActive: true, settings: { primary: "#222222" } });
    expect(r.template.code).toBe("market");
    expect(r.settings).toEqual({ ...TEMPLATES.market.defaults, primary: "#222222" });
  });
});

describe("template data (real data only)", () => {
  it("live: only this store's products and the categories they use", () => {
    const d = templateDataFromCatalog(store, {
      products: [product(1), product(2, { storeSlug: "other" })],
      categories,
    });
    expect(d.products.map((p) => p.id)).toEqual(["p1"]);
    expect(d.categories.map((c) => c.slug)).toEqual(["home"]);
  });
  it("seller preview: only active products, mapped like the live store", () => {
    const row = {
      id: "s1",
      owner_id: "u",
      name: "Kabul Goods",
      slug: "kabul-goods",
      description: "x",
      logo_url: null,
      banner_url: null,
      category: null,
      location: null,
      status: "draft",
      created_at: "",
      updated_at: "",
    };
    const sp = (id: string, status: string) => ({
      id,
      store_id: "s1",
      category_id: "c1",
      title: id,
      slug: id,
      description: null,
      price: 5,
      compare_price: null,
      stock: 3,
      featured_image: `https://img.example/${id}.jpg`,
      status,
      created_at: "2026-11-12T00:00:00Z",
      product_images: [],
    });
    const d = templateDataFromSeller(
      row,
      [sp("a", "active"), sp("b", "draft")],
      [
        { id: "c1", name: "Home", slug: "home", created_at: "" },
        { id: "c2", name: "Toys", slug: "toys", created_at: "" },
      ],
    );
    expect(d.products.map((p) => p.id)).toEqual(["a"]);
    expect(d.products[0]).toMatchObject({ storeSlug: "kabul-goods", category: "home" });
    expect(d.categories.map((c) => c.slug)).toEqual(["home"]);
  });
});

// ---------------------------------------------------------------------------
describe("WYSIWYG: preview and live render the same thing", () => {
  const strip = (html: string) => html.replace(/ data-mode="(live|preview)"/g, "");

  it.each(CODES)("%s: same markup and CSS variables in both modes", async (code) => {
    const settings = mergeSettings(TEMPLATES[code].defaults, {
      primary: "#123456",
      hero_title: "Big summer sale",
      show_announcement: true,
      announcement_text: "Free delivery in Kabul",
    });
    const live = render(code, settings, "live");
    const liveRoot = (await live.findByText("Big summer sale")).closest(".tpl") as HTMLElement;
    const liveHtml = strip(liveRoot.outerHTML);
    const liveStyle = liveRoot.getAttribute("style");
    live.unmount();

    const preview = render(code, settings, "preview");
    const previewRoot = (await preview.findByText("Big summer sale")).closest(
      ".tpl",
    ) as HTMLElement;
    expect(previewRoot.dataset["mode"]).toBe("preview");
    expect(strip(previewRoot.outerHTML)).toBe(liveHtml);
    expect(previewRoot.getAttribute("style")).toBe(liveStyle);
    expect(liveStyle).toContain("--tpl-primary: #123456");
  });

  it("the five templates are structurally different, not recolours", async () => {
    const structures = new Set<string>();
    for (const code of CODES) {
      const r = render(code, TEMPLATES[code].defaults, "live");
      const root = (await r.findAllByText("Product 1"))[0]!.closest(".tpl") as HTMLElement;
      expect(root.dataset["template"]).toBe(code);
      structures.add(
        [...root.children]
          .map((c) => c.tagName + "." + (c.className.split(" ")[0] ?? ""))
          .join(">"),
      );
      r.unmount();
    }
    expect(structures.size).toBe(CODES.length);
  });
});

describe("sections follow the real data", () => {
  it.each(CODES)(
    "%s: no products → friendly empty state, no categories/featured/about",
    async (code) => {
      const r = render(code, TEMPLATES[code].defaults, "live", {
        store: { ...store, description: "" },
        products: [],
        categories: [],
      });
      expect(await r.findByText(/hasn't added products yet/)).toBeInTheDocument();
      expect(r.queryByRole("group", { name: /shop by category/i })).toBeNull();
      expect(r.queryByText(/Hand-picked goods/)).toBeNull();
      r.unmount();
    },
  );

  it("toggles hide sections; announcement needs both the flag and text", async () => {
    const s = mergeSettings(TEMPLATES.classic.defaults, {
      show_categories: false,
      show_about: false,
      show_featured: false,
      show_announcement: true,
      announcement_text: "   ",
    });
    const r = render("classic", s, "live");
    await r.findByText("All products");
    expect(r.queryByRole("group", { name: /shop by category/i })).toBeNull();
    expect(r.queryByText("Featured")).toBeNull();
    expect(r.queryByText(/Hand-picked goods/)).toBeNull();
    expect(r.queryByRole("note")).toBeNull();
  });

  it("hero uses the store banner unless a custom https image is set", async () => {
    const r1 = render("classic", TEMPLATES.classic.defaults, "live");
    expect(
      (await r1.findByText("Kabul Goods", { selector: "h1" }))
        .closest("section")!
        .querySelector("img"),
    ).toHaveAttribute("src", "https://img.example/banner.jpg");
    r1.unmount();
    const s = mergeSettings(TEMPLATES.classic.defaults, {
      hero_image_url: "https://img.example/hero.jpg",
    });
    const r2 = render("classic", s, "live");
    expect(
      (await r2.findByText("Kabul Goods", { selector: "h1" }))
        .closest("section")!
        .querySelector("img"),
    ).toHaveAttribute("src", "https://img.example/hero.jpg");
  });

  it("seller text is rendered as text, never as HTML", async () => {
    const s = mergeSettings(TEMPLATES.classic.defaults, {
      hero_title: '<img src=x onerror="alert(1)">',
    });
    const r = render("classic", s, "live");
    const h1 = await r.findByText('<img src=x onerror="alert(1)">');
    expect(h1.tagName).toBe("H1");
    expect(h1.querySelector("img")).toBeNull();
  });

  it("category chips filter the grid in place", async () => {
    const r = render("classic", TEMPLATES.classic.defaults, "live");
    const group = await r.findByRole("group", { name: /shop by category/i });
    fireEvent.click(within(group).getByRole("button", { name: "Fashion" }));
    const grid = r.getByText("All products").closest("section")!;
    expect(within(grid).queryByText("Product 1")).toBeNull(); // odd = home
    expect(within(grid).getByText("Product 2")).toBeInTheDocument();
  });
});

describe("preview is inert, live is not", () => {
  it("add to cart works live but not in the editor preview", async () => {
    cart.add.mockClear();
    const live = render("classic", TEMPLATES.classic.defaults, "live");
    fireEvent.click((await live.findAllByRole("button", { name: /add product 1 to cart/i }))[0]!);
    expect(cart.add).toHaveBeenCalledWith("p1");
    live.unmount();

    cart.add.mockClear();
    const preview = render("classic", TEMPLATES.classic.defaults, "preview");
    fireEvent.click(
      (await preview.findAllByRole("button", { name: /add product 1 to cart/i }))[0]!,
    );
    expect(cart.add).not.toHaveBeenCalled();
    // …but category filters still work so the seller can try them.
    const group = screen.getByRole("group", { name: /shop by category/i });
    fireEvent.click(within(group).getByRole("button", { name: "Home" }));
    expect(within(group).getByRole("button", { name: "Home" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
