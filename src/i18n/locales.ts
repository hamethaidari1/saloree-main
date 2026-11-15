/**
 * The languages of the customer-facing site.
 *
 * Adding a language = add ONE entry here + ONE folder `src/locales/<code>/`
 * with the same JSON files as `en`. (`npm run i18n:check` tells you what's missing.)
 * Example for later: { code: "fa", nativeName: "فارسی", dir: "rtl", match: ["fa"] }.
 *
 * Imports in this folder use relative ".ts" paths so `node scripts/i18n-check.ts`
 * can run them directly.
 */
export interface LocaleInfo {
  /** BCP 47 code; also the folder name and the <html lang>. */
  code: string;
  /** The language's name in that language (never translated). */
  nativeName: string;
  dir: "ltr" | "rtl";
  /** Accept-Language primary tags (or full tags) that map to this locale. */
  match: readonly string[];
}

export const LOCALES = [
  { code: "en", nativeName: "English", dir: "ltr", match: ["en"] },
  { code: "es", nativeName: "Español", dir: "ltr", match: ["es"] },
  { code: "ar", nativeName: "العربية", dir: "rtl", match: ["ar"] },
  { code: "de", nativeName: "Deutsch", dir: "ltr", match: ["de"] },
  { code: "he", nativeName: "עברית", dir: "rtl", match: ["he", "iw"] },
  { code: "ko", nativeName: "한국어", dir: "ltr", match: ["ko"] },
  { code: "pt", nativeName: "Português", dir: "ltr", match: ["pt"] },
  {
    code: "zh-Hans",
    nativeName: "中文(简体)",
    dir: "ltr",
    match: ["zh-hans", "zh-cn", "zh-sg", "zh"],
  },
  {
    code: "zh-Hant",
    nativeName: "中文(繁體)",
    dir: "ltr",
    match: ["zh-hant", "zh-tw", "zh-hk", "zh-mo"],
  },
] as const satisfies readonly LocaleInfo[];

export type Locale = (typeof LOCALES)[number]["code"];
export const DEFAULT_LOCALE: Locale = "en";

/** Translation files per locale (src/locales/<code>/<namespace>.json). */
export const NAMESPACES = [
  "common",
  "nav",
  "home",
  "product",
  "cart",
  "checkout",
  "account",
  "auth",
  "footer",
  "errors",
  "categories",
  "orders",
  "store",
  "support",
] as const;
export type Namespace = (typeof NAMESPACES)[number];

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && LOCALES.some((l) => l.code === value);
}

export function localeInfo(locale: Locale): LocaleInfo {
  return LOCALES.find((l) => l.code === locale) ?? LOCALES[0];
}

export const dirFor = (locale: Locale) => localeInfo(locale).dir;

/**
 * Locale for Intl formatting. Arabic and Hebrew use Western digits
 * (-u-nu-latn) so prices and order numbers stay unambiguous.
 */
export function intlLocale(locale: Locale): string {
  return dirFor(locale) === "rtl" ? `${locale}-u-nu-latn` : locale;
}

/** "EN", "ES", "ZH" … shown next to the globe in the language menu. */
export const shortCode = (locale: Locale) => (locale.split("-")[0] ?? locale).toUpperCase();
