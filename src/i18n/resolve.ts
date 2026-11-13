/** Pure locale resolution: `lang` cookie → Accept-Language → English. */
import { DEFAULT_LOCALE, isLocale, LOCALES, type Locale, type LocaleInfo } from "./locales.ts";

/** Maps one language tag ("pt-BR", "zh-TW", "iw") to a supported locale, or null. */
export function matchLanguageTag(tag: string): Locale | null {
  const t = tag.trim().toLowerCase().replace(/_/g, "-");
  if (!t || t === "*") return null;
  const parts = t.split("-");
  const primary = parts[0] ?? "";
  // Chinese: decide by script, then region ("zh-Hant-HK", "zh-TW", "zh-CN"…).
  if (primary === "zh") {
    if (parts.includes("hant") || parts.some((p) => ["tw", "hk", "mo"].includes(p)))
      return "zh-Hant";
    return "zh-Hans";
  }
  // Exact full tags first, then the primary subtag.
  const matches = (l: LocaleInfo, tag: string) => l.match.includes(tag);
  for (const l of LOCALES) if (matches(l, t)) return l.code;
  for (const l of LOCALES) if (matches(l, primary)) return l.code;
  return null;
}

/** "de-CH,de;q=0.9,en;q=0.8" → tags in preference order (q=0 dropped). */
export function parseAcceptLanguage(header: string | null | undefined): string[] {
  if (!header) return [];
  return header
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const quality = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim(), quality: Number.isFinite(quality) ? quality : 0, index };
    })
    .filter((x) => x.tag && x.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)
    .map((x) => x.tag);
}

/**
 * Seller dashboard, admin panels and the owner preview are not translated yet:
 * they always render in English (with <html lang="en">) instead of half-translated.
 */
export const ENGLISH_ONLY_PREFIXES = ["/seller", "/admin", "/preview"] as const;
export function isEnglishOnlyPath(pathname: string) {
  return ENGLISH_ONLY_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function resolveLocale(input: {
  cookie?: string | null | undefined;
  acceptLanguage?: string | null | undefined;
}): Locale {
  if (isLocale(input.cookie)) return input.cookie;
  for (const tag of parseAcceptLanguage(input.acceptLanguage)) {
    const hit = matchLanguageTag(tag);
    if (hit) return hit;
  }
  return DEFAULT_LOCALE;
}
