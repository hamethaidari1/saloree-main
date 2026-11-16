/**
 * ISO 3166-1 alpha-2: every officially assigned code (249). Names come from
 * the browser's Intl.DisplayNames, so nothing here needs translating.
 */
export const ISO_COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ " +
  "BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM " +
  "DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS " +
  "GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN " +
  "KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ " +
  "MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM " +
  "PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV " +
  "SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI " +
  "VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

const CODES = new Set(ISO_COUNTRY_CODES);
export const isIsoCountry = (v: unknown): v is string => typeof v === "string" && CODES.has(v);

/** The 27 EU member states. */
export const EU_COUNTRIES =
  "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE".split(" ");
/** EU + the three other EEA states (Iceland, Liechtenstein, Norway). */
export const EU_EEA_COUNTRIES = [...EU_COUNTRIES, "IS", "LI", "NO"];
/** EU + EEA + Switzerland and the United Kingdom. */
export const EU_EEA_CH_GB_COUNTRIES = [...EU_EEA_COUNTRIES, "CH", "GB"];

let names: Intl.DisplayNames | null | undefined;
/** English country name ("DE" → "Germany"); the code itself if unknown. */
export function countryNameEn(code: string): string {
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(["en"], { type: "region" });
    } catch {
      names = null;
    }
  }
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Codes sorted by English name, for selects. */
export const COUNTRY_OPTIONS = () =>
  ISO_COUNTRY_CODES.map((code) => ({ code, name: countryNameEn(code) })).sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  );

let sorted: { code: string; name: string }[] | null = null;
/** The ISO code of a typed English name or code ("finland" → "FI"), or null. */
export function countryCodeForName(name: string): string | null {
  const n = name.trim().toLowerCase();
  if (!n) return null;
  sorted ??= COUNTRY_OPTIONS();
  return sorted.find((c) => c.name.toLowerCase() === n || c.code.toLowerCase() === n)?.code ?? null;
}
