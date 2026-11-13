/**
 * The `lang` cookie (like the cart cookie): in production on the real domain it
 * is scoped to `.<root domain>` so saloree.com and every <store>.saloree.com
 * share the choice; in development (or on any other host) it is host-only.
 */
import { isLocale, type Locale } from "./locales.ts";

export const LANG_COOKIE = "lang";
export const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export interface LangCookieOptions {
  /** ".saloree.com"-style sharing: the root domain, or null for host-only. */
  domain: string | null;
  secure: boolean;
}

/** The one place the cookie string is built. */
export function buildLangCookie(locale: Locale, opts: LangCookieOptions): string {
  const parts = [
    `${LANG_COOKIE}=${encodeURIComponent(locale)}`,
    "Path=/",
    `Max-Age=${LANG_COOKIE_MAX_AGE}`,
    "SameSite=Lax",
  ];
  if (opts.domain) parts.push(`Domain=.${opts.domain}`);
  if (opts.secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Options for this site: shared domain + Secure only in production on the
 * configured root domain (a Domain= the browser isn't on would be rejected).
 */
export function langCookieOptions(input: {
  dev: boolean;
  rootDomain: string;
  host: string;
  https: boolean;
}): LangCookieOptions {
  const onDomain =
    !!input.rootDomain &&
    (input.host === input.rootDomain || input.host.endsWith(`.${input.rootDomain}`));
  if (input.dev) return { domain: null, secure: false };
  return { domain: onDomain ? input.rootDomain : null, secure: input.https };
}

/** The saved locale from a `document.cookie` / Cookie header string, or null. */
export function readLangCookie(cookieHeader: string | null | undefined): Locale | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== LANG_COOKIE) continue;
    try {
      const value = decodeURIComponent(rest.join("="));
      return isLocale(value) ? value : null;
    } catch {
      return null;
    }
  }
  return null;
}
