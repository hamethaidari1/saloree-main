/** Locale-aware formatting through Intl. Prices stay in USD (no conversion). */
import { dirFor, intlLocale, type Locale } from "./locales.ts";

const isRtl = (locale: Locale) => dirFor(locale) === "rtl";

export const PRICE_CURRENCY = "USD";

const cache = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function memo<T extends Intl.NumberFormat | Intl.DateTimeFormat>(key: string, make: () => T): T {
  let f = cache.get(key) as T | undefined;
  if (!f) cache.set(key, (f = make()));
  return f;
}

/** Unicode LEFT-TO-RIGHT ISOLATE … POP DIRECTIONAL ISOLATE (invisible). */
const LRI = "\u2066";
const PDI = "\u2069";

export function formatPrice(amount: number, locale: Locale, currency: string = PRICE_CURRENCY) {
  const code = (currency || PRICE_CURRENCY).toUpperCase();
  try {
    const fmt = memo(
      `p|${locale}|${code}`,
      () => new Intl.NumberFormat(intlLocale(locale), { style: "currency", currency: code }),
    );
    if (!isRtl(locale)) return fmt.format(amount);
    // In RTL text the "$" of "US$" is a neutral character and would jump to the
    // other side ("$US"). Isolate just the symbol so CLDR's order is kept.
    return fmt
      .formatToParts(amount)
      .map((p) => (p.type === "currency" ? `${LRI}${p.value}${PDI}` : p.value))
      .join("");
  } catch {
    // Unknown currency code from the server: still show the amount.
    return `${formatNumber(amount, locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${code}`;
  }
}

export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions) {
  return memo(
    `n|${locale}|${JSON.stringify(options ?? {})}`,
    () => new Intl.NumberFormat(intlLocale(locale), options),
  ).format(value);
}

export function formatDate(
  value: string | number | Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { dateStyle: "medium" },
) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return memo(
    `d|${locale}|${JSON.stringify(options)}`,
    () => new Intl.DateTimeFormat(intlLocale(locale), options),
  ).format(d);
}

export const formatDateTime = (value: string | number | Date, locale: Locale) =>
  formatDate(value, locale, { dateStyle: "medium", timeStyle: "short" });
