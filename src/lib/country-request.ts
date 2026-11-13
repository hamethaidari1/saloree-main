/**
 * The visitor's delivery country for this request, read where the locale is:
 *  - saved: the `country` cookie (the visitor's own choice);
 *  - detected: the hosting platform's country header — on the SERVER only.
 *    The browser reuses what the server rendered (<html data-country>), so
 *    client navigations and hydration agree. Nothing is fetched from any API.
 */
import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie, getRequestHeader } from "@tanstack/react-start/server";
import { hostConfig, normalizeHost } from "./host";
import { parseCountryCode, type CountryCode } from "./countries";
import {
  buildCountryCookie,
  COUNTRY_COOKIE,
  countryCookieOptions,
  readCountryCookie,
} from "./country-cookie";
import { detectCountryFromHeaders, parseCountryHeader } from "./country-detect";

export interface CountryContext {
  saved: CountryCode | null;
  /** ISO alpha-2 from the hosting header (or the dev override), else null. */
  detected: string | null;
}

/** <html data-country="…"> carries the server's detection to the browser. */
export const DETECTED_COUNTRY_ATTR = "data-country";

export const readRequestCountry = createIsomorphicFn()
  .server((): CountryContext => ({
    saved: parseCountryCode(getCookie(COUNTRY_COOKIE)),
    detected: detectCountryFromHeaders((name) => getRequestHeader(name)),
  }))
  .client((): CountryContext => ({
    saved: readCountryCookie(document.cookie),
    detected: parseCountryHeader(document.documentElement.getAttribute(DETECTED_COUNTRY_ATTR)),
  }));

/** Saves the choice for a year (shared with store subdomains in production). */
export function saveCountryCookie(code: CountryCode) {
  const { dev, rootDomain } = hostConfig();
  document.cookie = buildCountryCookie(
    code,
    countryCookieOptions({
      dev,
      rootDomain,
      host: normalizeHost(window.location.host),
      https: window.location.protocol === "https:",
    }),
  );
}
