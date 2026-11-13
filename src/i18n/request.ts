import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";
import { hostConfig, normalizeHost } from "@/lib/host";
import { buildLangCookie, LANG_COOKIE, langCookieOptions, readLangCookie } from "./cookie";
import { isLocale, type Locale } from "./locales";
import { resolveLocale } from "./resolve";

/**
 * The locale for this request. Server: `lang` cookie → Accept-Language → en.
 * Browser: `lang` cookie → the language the server already rendered
 * (<html lang>, so hydration always agrees) → browser languages → en.
 */
export const readRequestLocale = createIsomorphicFn()
  .server((): Locale =>
    resolveLocale({
      cookie: getCookie(LANG_COOKIE) ?? null,
      acceptLanguage: getRequestHeader("accept-language") ?? null,
    }),
  )
  .client((): Locale => {
    const saved = readLangCookie(document.cookie);
    if (saved) return saved;
    const rendered = document.documentElement.getAttribute("lang");
    if (isLocale(rendered)) return rendered;
    return resolveLocale({ acceptLanguage: navigator.languages.join(",") });
  });

/** Saves the choice for a year (shared with store subdomains in production). */
export function saveLocaleCookie(locale: Locale) {
  const { dev, rootDomain } = hostConfig();
  document.cookie = buildLangCookie(
    locale,
    langCookieOptions({
      dev,
      rootDomain,
      host: normalizeHost(window.location.host),
      https: window.location.protocol === "https:",
    }),
  );
}
