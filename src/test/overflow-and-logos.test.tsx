import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PaymentMethods } from "@/components/marketplace/payment-methods";
import { PAYMENT_BRANDS } from "@/lib/payment-logos";

// jsdom has no layout engine, so these guard the CSS rules that prevent the
// overflow (a real-browser check is still needed; see the report).
const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");

/** Every declaration block whose selector list contains `selector` (exact). */
function blocksFor(selector: string): string[] {
  const out: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const m of css.matchAll(re)) {
    const selectors = m[1]!
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split(",")
      .map((s) => s.trim());
    if (selectors.includes(selector)) out.push(m[2]!);
  }
  return out;
}
const has = (selector: string, decl: RegExp) => blocksFor(selector).some((b) => decl.test(b));

describe("no horizontal overflow from long content", () => {
  it("checkout: minmax(0, …) tracks and a summary column of at most 420px", () => {
    expect(
      has(".checkout-grid", /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 420px\)/),
    ).toBe(true);
    expect(has(".checkout-side", /max-inline-size:\s*420px/)).toBe(true);
  });

  it("checkout: grid and flex children can shrink", () => {
    for (const sel of [
      ".checkout-main",
      ".checkout-side",
      ".checkout-card",
      ".checkout-summary-body",
      ".checkout-pay",
      ".checkout-items li > span",
      ".checkout-fields > *",
    ])
      expect(has(sel, /min-inline-size:\s*0/), sel).toBe(true);
    expect(has(".checkout-discount-row > input", /min-inline-size:\s*0/)).toBe(true);
    expect(has(".checkout-discount-row > button", /flex:\s*none/)).toBe(true);
  });

  it("checkout: item titles wrap anywhere and stop at 2 lines (never nowrap)", () => {
    const title = blocksFor(".checkout-item-title").join("\n");
    expect(title).toMatch(/overflow-wrap:\s*anywhere/);
    expect(title).toMatch(/-webkit-line-clamp:\s*2/);
    expect(title).toMatch(/(^|\s)line-clamp:\s*2/);
    expect(title).not.toMatch(/white-space:\s*nowrap/);
  });

  it("the same rules on the bag, My orders and the confirmation page", () => {
    expect(has(".checkout-lines > li > span:first-child", /min-inline-size:\s*0/)).toBe(true);
    expect(has(".checkout-lines > li > span:first-child", /overflow-wrap:\s*anywhere/)).toBe(true);
    expect(has(".cart-line > *", /min-inline-size:\s*0/)).toBe(true);
    expect(has(".cart-layout > *", /min-inline-size:\s*0/)).toBe(true);
    expect(has(".cart-line h3", /overflow-wrap:\s*anywhere/)).toBe(true);
    expect(has(".cart-store-heading", /overflow-wrap:\s*anywhere/)).toBe(true);
    expect(has(".checkout-pending", /overflow-wrap:\s*anywhere/)).toBe(true);
  });

  it("the checkout keeps the full title on the clamped line", () => {
    const src = readFileSync(join(process.cwd(), "src/routes/checkout.tsx"), "utf8");
    expect(src).toMatch(/className="checkout-item-title"[^>]*title=\{l\.product\.title\}/);
  });
});

describe("payment logos on white chips", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("every card/wallet logo and Cash on delivery sit on the same small white chip", () => {
    for (const sel of [".pay-logo", ".pay-cod"]) {
      const block = blocksFor(sel).join("\n");
      expect(block, sel).toMatch(/background:\s*var\(--footer-chip-bg\)/);
      expect(block, sel).toMatch(/border:\s*1px solid var\(--footer-chip-border\)/);
      expect(block, sel).toMatch(/border-radius:\s*4px/);
      expect(block, sel).toMatch(/block-size:\s*28px/);
      expect(block, sel).toMatch(/padding-inline:\s*\d+px/);
    }
    expect(has(".pay-list", /gap:\s*8px/)).toBe(true);
    // The chip is white in every theme (the token is not redefined for dark).
    expect(css).toMatch(/--footer-chip-bg:\s*oklch\(1 0 0\)/);
    expect((css.match(/--footer-chip-bg:/g) ?? []).length).toBe(1);
  });

  it("the names stay as alt text (or the chip text while a file is missing)", () => {
    vi.stubEnv("VITE_STRIPE_ENABLED", "true");
    render(<PaymentMethods />);
    const chips = screen.getAllByTestId("card-brand");
    expect(chips).toHaveLength(PAYMENT_BRANDS.length);
    chips.forEach((chip, i) => {
      expect(chip.className).toBe("pay-logo");
      expect(within(chip).getByRole("img", { name: PAYMENT_BRANDS[i]!.name })).toBeTruthy();
    });
  });

  it("the checkout's card option uses the same chips", () => {
    const src = readFileSync(join(process.cwd(), "src/routes/checkout.tsx"), "utf8");
    expect(src).toContain('<ul className="pay-list checkout-brands"');
    expect(src).toContain("<BrandLogo key={b.id} brand={b} />");
    expect(has(".checkout-brands img", /block-size:\s*24px/)).toBe(false); // no override of the chip size
  });
});
