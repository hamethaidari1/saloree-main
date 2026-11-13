/**
 * The visitor's country as the hosting platform reports it in a request
 * header (no IP address is read, stored or sent by us; no geolocation API).
 * Vercel: `x-vercel-ip-country`; Cloudflare: `cf-ipcountry`.
 */
export const COUNTRY_HEADERS = ["x-vercel-ip-country", "cf-ipcountry"] as const;

/** Values that mean "unknown": XX (unknown), T1 (Tor). */
const UNKNOWN = new Set(["XX", "T1"]);

/** "tr" / " TR " → "TR"; anything that isn't two letters (or is unknown) → null. */
export function parseCountryHeader(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && !UNKNOWN.has(code) ? code : null;
}

export type HeaderSource =
  | Headers
  | Record<string, string | string[] | null | undefined>
  | ((name: string) => string | null | undefined);

function headerValue(headers: HeaderSource, name: string): unknown {
  if (typeof headers === "function") return headers(name);
  if (typeof Headers !== "undefined" && headers instanceof Headers) return headers.get(name);
  const record = headers as Record<string, string | string[] | null | undefined>;
  const key = Object.keys(record).find((k) => k.toLowerCase() === name);
  const value = key === undefined ? undefined : record[key];
  return Array.isArray(value) ? value[0] : value;
}

/** The first valid country among the known headers (Vercel first), or null. */
export function detectCountryFromHeaders(headers: HeaderSource): string | null {
  for (const name of COUNTRY_HEADERS) {
    const code = parseCountryHeader(headerValue(headers, name));
    if (code) return code;
  }
  return null;
}

/** Dev only: `?country=TR` stands in for the hosting header. */
export function devCountryOverride(search: Record<string, unknown>, dev: boolean): string | null {
  return dev ? parseCountryHeader(search["country"]) : null;
}
