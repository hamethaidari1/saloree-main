import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { ZodIssue } from "zod";
import { renderWithRouter } from "./router-harness";
import { resourcesFor, WithLocale } from "./i18n";
import {
  DEFAULT_LOCALE,
  dirFor,
  intlLocale,
  LOCALES,
  NAMESPACES,
  type Locale,
} from "@/i18n/locales";
import {
  isEnglishOnlyPath,
  matchLanguageTag,
  parseAcceptLanguage,
  resolveLocale,
} from "@/i18n/resolve";
import {
  buildLangCookie,
  langCookieOptions,
  LANG_COOKIE_MAX_AGE,
  readLangCookie,
} from "@/i18n/cookie";
import { createI18n } from "@/i18n/instance";
import { formatDate, formatNumber, formatPrice } from "@/i18n/format";
import { checkAll, checkLocale, pluralCategories, type LocaleFiles } from "@/i18n/check";
import { errorKey, translateError, validationMessage } from "@/i18n/messages";
import { headT } from "@/i18n/head";
import { LanguagePanel } from "@/components/marketplace/header/language-select";
import { CategoryGrid } from "@/components/marketplace/category-grid";

const CODES = LOCALES.map((l) => l.code);
const all = Object.fromEntries(CODES.map((c) => [c, resourcesFor(c)])) as Record<
  string,
  LocaleFiles
>;

describe("locale resolution: lang cookie → Accept-Language → en", () => {
  it("a valid cookie beats the header", () => {
    expect(resolveLocale({ cookie: "de", acceptLanguage: "ar,en;q=0.5" })).toBe("de");
  });
  it("an unknown cookie value is ignored", () => {
    expect(resolveLocale({ cookie: "xx", acceptLanguage: "ko-KR" })).toBe("ko");
  });
  it("falls back to English", () => {
    expect(resolveLocale({})).toBe("en");
    expect(resolveLocale({ acceptLanguage: "fr-FR,it;q=0.8" })).toBe("en");
    expect(resolveLocale({ acceptLanguage: "*" })).toBe("en");
  });
  it("honours q-values and skips q=0", () => {
    expect(parseAcceptLanguage("fr;q=0.2, de;q=0.9, en;q=0")).toEqual(["de", "fr"]);
    expect(resolveLocale({ acceptLanguage: "fr;q=0.9, es;q=0.8" })).toBe("es");
  });
  it.each([
    ["zh-CN", "zh-Hans"],
    ["zh-SG", "zh-Hans"],
    ["zh", "zh-Hans"],
    ["zh-Hans-CN", "zh-Hans"],
    ["zh-TW", "zh-Hant"],
    ["zh-HK", "zh-Hant"],
    ["zh-MO", "zh-Hant"],
    ["zh-Hant", "zh-Hant"],
    ["es-MX", "es"],
    ["es-419", "es"],
    ["pt-BR", "pt"],
    ["pt-PT", "pt"],
    ["ar-EG", "ar"],
    ["he-IL", "he"],
    ["iw", "he"],
    ["de-AT", "de"],
    ["ko-KR", "ko"],
    ["en-GB", "en"],
    ["fr-FR", null],
  ])("%s → %s", (tag, expected) => expect(matchLanguageTag(tag)).toBe(expected));

  it("seller/admin/preview stay English (not translated yet)", () => {
    expect(isEnglishOnlyPath("/seller/orders")).toBe(true);
    expect(isEnglishOnlyPath("/admin")).toBe(true);
    expect(isEnglishOnlyPath("/preview/store")).toBe(true);
    expect(isEnglishOnlyPath("/sellers-guide")).toBe(false);
    expect(isEnglishOnlyPath("/")).toBe(false);
  });
});

describe("lang cookie", () => {
  it("production on the real domain: shared with store subdomains, Secure, 1 year", () => {
    const opts = langCookieOptions({
      dev: false,
      rootDomain: "saloree.com",
      host: "shop1.saloree.com",
      https: true,
    });
    expect(buildLangCookie("ar", opts)).toBe(
      `lang=ar; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax; Domain=.saloree.com; Secure`,
    );
    expect(LANG_COOKIE_MAX_AGE).toBe(31_536_000);
  });
  it("development is host-only and not Secure", () => {
    const opts = langCookieOptions({
      dev: true,
      rootDomain: "saloree.com",
      host: "localhost:8080",
      https: false,
    });
    expect(buildLangCookie("de", opts)).toBe(
      `lang=de; Path=/; Max-Age=${LANG_COOKIE_MAX_AGE}; SameSite=Lax`,
    );
  });
  it("another host in production (e.g. a preview URL) gets no Domain the browser would reject", () => {
    expect(
      langCookieOptions({
        dev: false,
        rootDomain: "saloree.com",
        host: "preview.lovable.app",
        https: true,
      }),
    ).toEqual({ domain: null, secure: true });
  });
  it("encodes codes with a hyphen and reads them back", () => {
    const c = buildLangCookie("zh-Hant", { domain: null, secure: false });
    expect(readLangCookie(c.split(";")[0])).toBe("zh-Hant");
    expect(readLangCookie("a=1; lang=he; b=2")).toBe("he");
    expect(readLangCookie("lang=xx")).toBeNull();
    expect(readLangCookie("lang=%E0%A4%A")).toBeNull();
    expect(readLangCookie(undefined)).toBeNull();
  });
});

describe("dir and lang per language", () => {
  it.each(LOCALES.map((l) => [l.code, l.dir]))("%s is %s", (code, dir) =>
    expect(dirFor(code as Locale)).toBe(dir),
  );
  it("Arabic and Hebrew are RTL; Chinese keeps its script subtag", () => {
    expect(LOCALES.filter((l) => l.dir === "rtl").map((l) => l.code)).toEqual(["ar", "he"]);
    expect(CODES).toContain("zh-Hans");
    expect(CODES).toContain("zh-Hant");
  });
  it("each language is listed in its own name", () => {
    expect(LOCALES.map((l) => l.nativeName)).toEqual([
      "English",
      "Español",
      "العربية",
      "Deutsch",
      "עברית",
      "한국어",
      "Português",
      "中文(简体)",
      "中文(繁體)",
    ]);
  });
});

describe("plurals", () => {
  it("Arabic uses all six forms", () => {
    expect(pluralCategories("ar")).toEqual(["zero", "one", "two", "few", "many", "other"]);
    const t = createI18n("ar", resourcesFor("ar")).getFixedT("ar", "nav");
    const forms = [0, 1, 2, 3, 11, 100].map((count) => t("cartAria", { count }));
    expect(new Set(forms).size).toBe(6);
    expect(forms[1]).toBe("السلة، عنصر واحد");
    expect(forms[2]).toBe("السلة، عنصران");
    expect(forms[3]).toBe("السلة، 3 عناصر");
  });
  it("Hebrew has a dual; Chinese has a single form", () => {
    const he = createI18n("he", resourcesFor("he")).getFixedT("he", "cart");
    expect(he("subtotalItems", { count: 2 })).toBe("סכום ביניים (שני פריטים)");
    const zh = createI18n("zh-Hans", resourcesFor("zh-Hans")).getFixedT("zh-Hans", "cart");
    expect(zh("subtotalItems", { count: 1 })).toBe("小计（1 件商品）");
    expect(zh("subtotalItems", { count: 5 })).toBe("小计（5 件商品）");
  });
  it("English one/other", () => {
    const t = createI18n("en", resourcesFor("en")).getFixedT("en", "product");
    expect(t("browse.finds", { count: 1 })).toBe("1 find");
    expect(t("browse.finds", { count: 4 })).toBe("4 finds");
  });
});

describe("translation files (same check as npm run i18n:check)", () => {
  it("every locale has the same keys, placeholders, tags and valid plural forms", () => {
    expect(checkAll(all, CODES)).toEqual([]);
  });
  it("every namespace is non-empty in every locale", () => {
    for (const code of CODES)
      for (const ns of NAMESPACES)
        expect(Object.keys(all[code]![ns]!).length, `${code}/${ns}`).toBeGreaterThan(0);
  });
  it("catches a missing key, a changed placeholder, a lost tag and wrong plural forms", () => {
    const en = all["en"]!;
    const broken: LocaleFiles = JSON.parse(JSON.stringify(all["de"]));
    delete (broken["common"] as Record<string, unknown>)["viewAll"];
    (broken["cart"] as Record<string, string>)["each"] = "je {{preis}}";
    (broken["auth"] as Record<string, Record<string, string>>)["login"]!["newTo"] =
      "Neu? Konto erstellen";
    (broken["nav"] as Record<string, string>)["cartAria_few"] = "x";
    const problems = checkLocale("de", broken, en);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringContaining('common.json "viewAll": missing'),
        expect.stringContaining('cart.json "each": placeholders'),
        expect.stringContaining('auth.json "login.newTo": tags'),
        expect.stringContaining('nav.json "cartAria": plural form(s) few don\'t exist in de'),
      ]),
    );
  });
  it("Arabic without its six forms fails", () => {
    const ar: LocaleFiles = JSON.parse(JSON.stringify(all["ar"]));
    delete (ar["nav"] as Record<string, unknown>)["cartAria_two"];
    expect(checkLocale("ar", ar, all["en"]!)).toEqual([
      'ar/nav.json "cartAria": missing plural form(s) two for ar',
    ]);
  });
});

describe("formatting (Intl, USD, no conversion)", () => {
  it("prices in USD per locale; Arabic and Hebrew keep Western digits", () => {
    expect(formatPrice(1234.5, "en")).toBe("$1,234.50");
    expect(formatPrice(1234.5, "de")).toMatch(/^1\.234,50\s\$$/);
    expect(formatPrice(1234.5, "es")).toMatch(/1234,50|1\.234,50/);
    for (const rtl of ["ar", "he"] as const) {
      const s = formatPrice(1234.5, rtl);
      expect(s).toMatch(/1,234\.50/);
      expect(s).not.toMatch(/[٠-٩]/); // no Arabic-Indic digits
    }
    expect(intlLocale("ar")).toBe("ar-u-nu-latn");
    expect(intlLocale("de")).toBe("de");
  });
  it("numbers and dates follow the locale", () => {
    expect(formatNumber(1234567, "de")).toBe("1.234.567");
    expect(formatNumber(4.5, "de", { minimumFractionDigits: 1 })).toBe("4,5");
    expect(
      formatDate("2026-11-13T10:00:00Z", "zh-Hans", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    ).toBe("2026年11月13日");
    expect(formatDate("not a date", "en")).toBe("");
  });
  it("an unknown currency still shows the amount", () => {
    expect(formatPrice(5, "en", "NOPE")).toBe("5.00 NOPE");
  });
});

describe("language selector", () => {
  beforeEach(() => {
    document.cookie = "lang=; Max-Age=0; Path=/";
  });

  async function renderPanel(locale: Locale = "en", onDone = vi.fn()) {
    const view = renderWithRouter(
      <WithLocale locale={locale}>
        <LanguagePanel onDone={onDone} />
      </WithLocale>,
    );
    const group = await screen.findByRole("radiogroup");
    return { ...view, group, onDone };
  }

  it("is a radiogroup of the 9 languages in their own names, each with lang=", async () => {
    const { group } = await renderPanel("en");
    expect(group).toHaveAccessibleName("Change language");
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(9);
    expect(radios.map((r) => r.textContent)).toEqual(LOCALES.map((l) => l.nativeName));
    LOCALES.forEach((l, i) => {
      const label = radios[i]!.querySelector(`[lang="${l.code}"]`);
      expect(label, l.code).not.toBeNull();
    });
    expect(
      radios.filter((r) => r.getAttribute("aria-checked") === "true").map((r) => r.textContent),
    ).toEqual(["English"]);
    // One tab stop (roving tabindex) on the current language.
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1, -1, -1]);
    expect(screen.getByText("Prices are shown in US dollars (USD).")).toBeTruthy();
  });

  it("arrow keys / Home / End move focus without applying", async () => {
    const { group, onDone } = await renderPanel("en");
    const radios = within(group).getAllByRole("radio");
    radios[0]!.focus();
    fireEvent.keyDown(radios[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(radios[1]);
    fireEvent.keyDown(radios[1]!, { key: "End" });
    expect(document.activeElement).toBe(radios[8]);
    fireEvent.keyDown(radios[8]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(radios[0]);
    fireEvent.keyDown(radios[0]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(radios[8]);
    expect(onDone).not.toHaveBeenCalled();
    expect(document.cookie).not.toMatch(/lang=/);
  });

  it("choosing a language saves the cookie, reloads route data and closes", async () => {
    const { group, onDone, router } = await renderPanel("en");
    const invalidate = vi.spyOn(router, "invalidate");
    fireEvent.click(within(group).getByRole("radio", { name: "Deutsch" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(document.cookie).toMatch(/(^|; )lang=de(;|$)/);
    expect(invalidate).toHaveBeenCalled();
  });

  it("is shown in the current language (German)", async () => {
    const { group } = await renderPanel("de");
    expect(group).toHaveAccessibleName("Sprache ändern");
    expect(within(group).getByRole("radio", { name: "Deutsch" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByText("Preise werden in US-Dollar (USD) angezeigt.")).toBeTruthy();
  });
});

describe("category names", () => {
  it("known slugs are translated; a new category shows its database name", async () => {
    renderWithRouter(
      <WithLocale locale="de">
        <CategoryGrid
          categories={[
            { slug: "electronics", name: "Electronics" },
            { slug: "garden", name: "Garden & Patio" },
          ]}
        />
      </WithLocale>,
    );
    const links = await screen.findAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Elektronik", "Garden & Patio"]);
  });
});

describe("page titles per language", () => {
  const matches = (locale: Locale) => [
    { routeId: "__root__", context: { i18n: { locale, resources: resourcesFor(locale) } } },
  ];
  it("head() text comes from the active language", () => {
    expect(headT(matches("en"), "home")("meta.title")).toBe(
      "Saloree — Independent stores. Extraordinary finds.",
    );
    expect(headT(matches("ar"), "home")("meta.title")).toBe(
      "Saloree — متاجر مستقلة. اكتشافات استثنائية.",
    );
    expect(headT(matches("zh-Hant"), "cart")("meta.title")).toBe("你的購物袋 — Saloree");
  });
  it("defaults to English", () => expect(DEFAULT_LOCALE).toBe("en"));
});

describe("errors and validation messages", () => {
  const t = createI18n("es", resourcesFor("es")).getFixedT("es", "errors");
  it("known server errors are translated; unknown ones keep the server's message", () => {
    expect(errorKey({ code: "42501", message: "permission denied for table orders" })).toBe(
      "db.permission",
    );
    expect(errorKey({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe(
      "auth.invalidCredentials",
    );
    expect(errorKey({ message: "User already registered" })).toBe("auth.alreadyRegistered");
    expect(translateError(t, { code: "42501" }, { "42501": "orders.cannotCancel" })).toBe(
      "Este pedido ya no se puede cancelar.",
    );
    expect(translateError(t, { code: "P0001", message: "stock changed for product X" })).toBe(
      "stock changed for product X",
    );
    expect(translateError(t, {})).toBe("Algo salió mal. Inténtalo de nuevo.");
  });
  it("validation by field and kind (not by English text); empty is 'required'", () => {
    const tooSmall = {
      code: "too_small",
      minimum: 2,
      path: ["full_name"],
      message: "x",
    } as unknown as ZodIssue;
    expect(validationMessage(t, "full_name", tooSmall, "A")).toBe(
      "Tu nombre completo parece demasiado corto.",
    );
    expect(validationMessage(t, "full_name", tooSmall, "  ")).toBe("Introduce tu nombre completo.");
    const regex = {
      code: "invalid_string",
      validation: "regex",
      path: ["phone"],
      message: "x",
    } as unknown as ZodIssue;
    expect(validationMessage(t, "phone", regex, "abc")).toBe(
      "Introduce un número de teléfono válido.",
    );
    const odd = { code: "custom", path: ["notes"], message: "x" } as unknown as ZodIssue;
    expect(validationMessage(t, "notes", odd, "x")).toBe("Revisa este campo.");
  });
});
