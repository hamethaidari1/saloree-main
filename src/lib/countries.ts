/**
 * Delivery countries (pure data, no React): the "Deliver to" list, and the
 * mapping from a detected ISO 3166-1 alpha-2 code to an entry of that list.
 */

/** Delivery countries, in display order. "Other" covers everywhere else. */
export const COUNTRIES = [
  { code: "AF", name: "Afghanistan" },
  { code: "FI", name: "Finland" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "SE", name: "Sweden" },
  { code: "NL", name: "Netherlands" },
  { code: "TR", name: "Turkey" },
  { code: "GB", name: "United Kingdom" },
  { code: "OTHER", name: "Other" },
] as const;
export type Country = (typeof COUNTRIES)[number];
export type CountryCode = Country["code"];
/** A real country of the list (everything except "Other"). */
export type DeliveryCountryCode = Exclude<CountryCode, "OTHER">;

/** Only known codes are accepted (from a cookie, storage or a click). */
export function parseCountryCode(value: unknown): CountryCode | null {
  return COUNTRIES.find((c) => c.code === value)?.code ?? null;
}
export const countryByCode = (code: CountryCode | null) =>
  COUNTRIES.find((c) => c.code === code) ?? null;

/**
 * Detected country (ISO alpha-2) → delivery country. Built from COUNTRIES, so
 * a country added to (or removed from) the list is offered (or not) with no
 * second place to update. "Other" is never suggested.
 */
export const DELIVERY_COUNTRY_BY_ISO: Readonly<Record<string, DeliveryCountryCode>> =
  Object.fromEntries(
    COUNTRIES.filter(
      (c): c is Extract<Country, { code: DeliveryCountryCode }> => c.code !== "OTHER",
    ).map((c) => [c.code, c.code]),
  );

export function deliveryCountryForIso(iso: string | null | undefined): DeliveryCountryCode | null {
  if (!iso) return null;
  return DELIVERY_COUNTRY_BY_ISO[iso.toUpperCase()] ?? null;
}
