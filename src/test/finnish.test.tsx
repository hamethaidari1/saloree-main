import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { renderWithRouter } from "./router-harness";
import { resourcesFor, WithLocale } from "./i18n";
import { dirFor, LOCALES, NAMESPACES, type Locale } from "@/i18n/locales";
import { matchLanguageTag, resolveLocale } from "@/i18n/resolve";
import { createI18n } from "@/i18n/instance";
import { formatDate, formatDateTime, formatNumber, formatPrice } from "@/i18n/format";
import { checkLocale, flatten, pluralCategories } from "@/i18n/check";
import { headT } from "@/i18n/head";
import { readLangCookie } from "@/i18n/cookie";
import { LanguagePanel } from "@/components/marketplace/header/language-select";
import { CountryCombobox } from "@/components/checkout/country-combobox";
import { countryCodeForName, countryName } from "@/lib/iso-countries";

const fi = resourcesFor("fi");
const en = resourcesFor("en");
const matches = (locale: Locale) => [
  { routeId: "__root__", context: { i18n: { locale, resources: resourcesFor(locale) } } },
];

describe("Finnish: one folder and one LOCALES entry", () => {
  it("is listed as Suomi, left to right", () => {
    const entry = LOCALES.find((l) => l.code === "fi");
    expect(entry).toEqual({ code: "fi", nativeName: "Suomi", dir: "ltr", match: ["fi"] });
    expect(dirFor("fi")).toBe("ltr");
  });

  it("resolves from the cookie and from Accept-Language (fi, fi-FI); the cookie wins", () => {
    expect(matchLanguageTag("fi")).toBe("fi");
    expect(matchLanguageTag("fi-FI")).toBe("fi");
    expect(matchLanguageTag("FI_fi")).toBe("fi");
    expect(resolveLocale({ cookie: "fi" })).toBe("fi");
    expect(resolveLocale({ acceptLanguage: "fi-FI,fi;q=0.9,en;q=0.8" })).toBe("fi");
    expect(resolveLocale({ acceptLanguage: "sv-FI, fi;q=0.8" })).toBe("fi"); // Swedish isn't offered
    expect(resolveLocale({ cookie: "de", acceptLanguage: "fi-FI" })).toBe("de");
    expect(resolveLocale({ cookie: "fi", acceptLanguage: "de-DE" })).toBe("fi");
    expect(resolveLocale({ acceptLanguage: "de;q=0.9, fi;q=0.5" })).toBe("de"); // same priority rules
  });

  it("every namespace has exactly the English keys, placeholders and tags", () => {
    expect(checkLocale("fi", fi, en)).toEqual([]);
    for (const ns of NAMESPACES) {
      const keys = (tree: object) => [...flatten(tree as never).keys()].sort();
      expect(keys(fi[ns]), ns).toEqual(keys(en[ns]));
    }
    // No English left by accident in a few key places.
    expect(fi.checkout["place"]).toBe("Tee tilaus");
    expect((fi.product as Record<string, unknown>)["addToCart"]).toBe("Lisää ostoskoriin");
    expect(fi.cart["toCheckout"]).toBe("Siirry kassalle");
  });

  it("placeholders are kept exactly, and Saloree is never translated or inflected", () => {
    const enFlat = new Map<string, unknown>();
    const fiFlat = new Map<string, unknown>();
    for (const ns of NAMESPACES) {
      for (const [k, v] of flatten(en[ns] as never)) enFlat.set(`${ns}:${k}`, v);
      for (const [k, v] of flatten(fi[ns] as never)) fiFlat.set(`${ns}:${k}`, v);
    }
    const vars = (s: unknown) =>
      [...String(s).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort();
    for (const [k, v] of enFlat) expect(vars(fiFlat.get(k)), k).toEqual(vars(v));
    for (const [k, v] of fiFlat) {
      // "Saloree", "Saloree-…" and the genitive "Saloreen" only — never a misspelt ending.
      for (const m of String(v).matchAll(/Saloo?re\w*/g))
        expect(["Saloree", "Saloreen"], `${k}: ${m[0]}`).toContain(m[0]);
      // A variable is never followed by a case ending ("{{store}}ssa").
      expect(String(v), k).not.toMatch(/\}\}[a-zäö]/);
    }
  });

  it("plural rules are Finnish (one/other), not an English fallback", () => {
    expect(pluralCategories("fi")).toEqual(["one", "other"]);
    const t = createI18n("fi", fi).getFixedT("fi", "product");
    expect(t("browse.finds", { count: 1 })).toBe("1 löytö");
    expect(t("browse.finds", { count: 0 })).toBe("0 löytöä");
    expect(t("browse.finds", { count: 5 })).toBe("5 löytöä");
    const nav = createI18n("fi", fi).getFixedT("fi", "nav");
    expect(nav("cartAria", { count: 1 })).toBe("Ostoskori, 1 tuote");
    expect(nav("cartAria", { count: 3 })).toBe("Ostoskori, 3 tuotetta");
  });

  it("titles and meta descriptions are Finnish", () => {
    expect(headT(matches("fi"), "cart")("meta.title")).toBe("Ostoskorisi — Saloree");
    expect(headT(matches("fi"), "checkout")("metaTitle")).toBe("Kassa — Saloree");
    expect(headT(matches("fi"))("meta.defaultDescription")).toMatch(/itsenäisiltä kaupoilta/);
  });

  it("the payment screen, widget, chat toast and legal note are Finnish", () => {
    const co = fi.checkout as unknown as {
      overlay: { title: string; step: Record<string, string> };
    };
    expect(co.overlay.title).toBe("Tilaustasi suojataan…");
    expect(Object.values(co.overlay.step)).toEqual([
      "Tilausta tehdään",
      "Tuotteita varataan",
      "Yhdistetään Stripeen",
    ]);
    const widget = (fi.common as unknown as { sideWidget: Record<string, string> }).sideWidget;
    expect([widget["messages"], widget["feedback"], widget["top"]]).toEqual([
      "Viestit",
      "Palaute",
      "Ylös",
    ]);
    expect(fi.support["newMessageFromTeam"]).toBe("Uusi viesti Saloree-tiimiltä");
    const legal = (fi.common as unknown as { legal: Record<string, string> }).legal;
    expect(legal["englishOnly"]).toBe("Tämä sivu on toistaiseksi saatavilla vain englanniksi.");
  });

  it("meta.json says it is not reviewed, and the README has a Finnish checklist", () => {
    const meta = JSON.parse(readFileSync(join(process.cwd(), "src/locales/fi/meta.json"), "utf8"));
    expect(meta.reviewed).toBe(false);
    const readme = readFileSync(join(process.cwd(), "src/locales/README.md"), "utf8");
    expect(readme).toMatch(/### Finnish \(`fi`\) review checklist/);
    expect(readme).toMatch(/\|\s*fi\s*\|\s*Suomi\s*\|/);
  });
});

describe("Finnish formatting (Intl fi-FI)", () => {
  const NBSP = " ";
  it("prices stay USD: comma decimals, symbol after a non-breaking space", () => {
    expect(formatPrice(0.99, "fi")).toBe(`0,99${NBSP}$`);
    expect(formatPrice(1234.5, "fi")).toBe(`1${NBSP}234,50${NBSP}$`);
    expect(formatPrice(39.99, "fi")).not.toContain("."); // never "39.99"
  });
  it("numbers and dates: space groups, d.M.yyyy, 24-hour time", () => {
    expect(formatNumber(1234567.5, "fi")).toBe(`1${NBSP}234${NBSP}567,5`);
    expect(formatDate("2026-11-16T15:05:00Z", "fi", { dateStyle: "short", timeZone: "UTC" })).toBe(
      "16.11.2026",
    );
    expect(formatDate("2026-11-16T15:05:00Z", "fi", { timeStyle: "short", timeZone: "UTC" })).toBe(
      "15.05",
    );
    expect(formatDateTime("2026-11-16T15:05:00Z", "fi")).not.toMatch(/AM|PM/i);
  });
  it("the pay button reads Maksa 0,99 $", () => {
    const t = createI18n("fi", fi).getFixedT("fi", "checkout");
    expect(t("payAmount", { amount: formatPrice(0.99, "fi") })).toBe(`Maksa 0,99${NBSP}$`);
  });
  it("no price is ever parsed back from a formatted string", () => {
    for (const f of [
      "src/routes/checkout.tsx",
      "src/routes/cart.tsx",
      "src/routes/product.$id.tsx",
    ]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, f).not.toMatch(/parseFloat\(|Number\(format|\.price\([^)]*\)\.replace/);
    }
  });
});

describe("Finnish in the UI", () => {
  beforeEach(() => {
    document.cookie = "lang=; Max-Age=0; Path=/";
  });

  it("the selector lists all 10 languages (Suomi with lang=fi) and remembers the choice", async () => {
    const onDone = vi.fn();
    renderWithRouter(
      <WithLocale locale="en">
        <LanguagePanel onDone={onDone} />
      </WithLocale>,
    );
    const group = await screen.findByRole("radiogroup");
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(10);
    const suomi = within(group).getByRole("radio", { name: "Suomi" });
    expect(suomi.querySelector('[lang="fi"]')?.textContent).toBe("Suomi");
    expect(suomi.textContent).not.toMatch(/🇫🇮/); // no flags
    fireEvent.click(suomi);
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(readLangCookie(document.cookie)).toBe("fi");
  });

  it("shown in Finnish when Finnish is active", async () => {
    renderWithRouter(
      <WithLocale locale="fi">
        <LanguagePanel onDone={vi.fn()} />
      </WithLocale>,
    );
    const group = await screen.findByRole("radiogroup");
    expect(group).toHaveAccessibleName("Vaihda kieli");
    expect(within(group).getByRole("radio", { name: "Suomi" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("Hinnat näytetään Yhdysvaltain dollareina (USD).")).toBeTruthy();
  });

  it("country names in Finnish (Intl.DisplayNames), the order still gets the English name", () => {
    expect(countryName("FI", "fi")).toBe("Suomi");
    expect(countryName("SE", "fi")).toBe("Ruotsi");
    expect(countryCodeForName("Ruotsi", "fi")).toBe("SE");
    expect(countryCodeForName("Sweden", "fi")).toBe("SE"); // English typed works too
    const onChange = vi.fn();
    render(
      <WithLocale locale="fi">
        <CountryCombobox
          id="c"
          value=""
          onChange={onChange}
          placeholder="Hae maata"
          noMatch="—"
          listLabel="Maat"
        />
      </WithLocale>,
    );
    const input = screen.getByRole("combobox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ruot" } });
    expect(
      within(screen.getByRole("listbox"))
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Ruotsi"]);
    fireEvent.change(input, { target: { value: "Suomi" } });
    expect(onChange).toHaveBeenLastCalledWith("FI");
    const checkout = readFileSync(join(process.cwd(), "src/routes/checkout.tsx"), "utf8");
    expect(checkout).toContain('country: code ? countryNameEn(code) : ""');
  });

  it("long Finnish words wrap or hyphenate instead of overflowing; widget labels stay on one line", () => {
    const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
    expect(css).toMatch(
      /html:lang\(fi\) body,[\s\S]*?\{\s*overflow-wrap: break-word;\s*hyphens: auto;/,
    );
    expect(css).toMatch(/html:lang\(fi\) :is\(input, textarea, select, code, \.tabular-nums\)/);
    expect(css).toMatch(/\.side-widget-label \{\s*white-space: nowrap;/);
    // The longest Finnish labels in the places that used to overflow.
    const longest = [
      fi.checkout["delivery"],
      (fi.footer as Record<string, string>)["paymentMethods"],
    ];
    expect(longest).toEqual(["Toimitustiedot", "Maksutavat"]);
  });
});
