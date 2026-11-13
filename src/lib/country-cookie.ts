/**
 * The `country` cookie: the visitor's chosen delivery country (a preference,
 * like `lang`). Readable by the server, so the first HTML already shows it.
 * In production on the real domain it is scoped to `.<root domain>` (shared
 * with store subdomains); in development or on other hosts it is host-only.
 */
import { langCookieOptions, type LangCookieOptions } from "@/i18n/cookie";
import { parseCountryCode, type CountryCode } from "./countries";

export const COUNTRY_COOKIE = "country";
export const COUNTRY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export type CountryCookieOptions = LangCookieOptions;
/** Same rules as the `lang` cookie (shared domain + Secure in production only). */
export const countryCookieOptions = langCookieOptions;

/** The one place the cookie string is built. */
export function buildCountryCookie(code: CountryCode, opts: CountryCookieOptions): string {
  const parts = [
    `${COUNTRY_COOKIE}=${encodeURIComponent(code)}`,
    "Path=/",
    `Max-Age=${COUNTRY_COOKIE_MAX_AGE}`,
    "SameSite=Lax",
  ];
  if (opts.domain) parts.push(`Domain=.${opts.domain}`);
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

/** The saved country from a `document.cookie` / Cookie header string, or null. */
export function readCountryCookie(cookieHeader: string | null | undefined): CountryCode | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== COUNTRY_COOKIE) continue;
    try {
      return parseCountryCode(decodeURIComponent(rest.join("=")));
    } catch {
      return null;
    }
  }
  return null;
}
