/**
 * Translation checks, shared by `npm run i18n:check` and the test suite.
 * Pure: give it the parsed JSON, get a list of problems back.
 *
 * Rules, per locale, compared with English:
 *  - same keys (no missing, no extra), no empty values;
 *  - same {{placeholders}} and the same <1>…</1> tags (Trans components);
 *  - plural keys (`key_one`, `key_other`, …) have exactly the plural
 *    categories that language uses (Intl.PluralRules), e.g. Arabic needs
 *    zero/one/two/few/many/other and Chinese only other.
 *
 * Relative ".ts" imports so Node can run it directly.
 */
import { NAMESPACES } from "./locales.ts";

export type Tree = { [key: string]: string | Tree };
export type LocaleFiles = Record<string, Tree>; // namespace -> tree

const PLURAL_SUFFIXES = ["zero", "one", "two", "few", "many", "other"] as const;
const PLURAL_RE = new RegExp(`^(.*)_(${PLURAL_SUFFIXES.join("|")})$`);

/** "a.b.c" -> value, for every leaf. */
export function flatten(tree: Tree, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v))
      for (const [kk, vv] of flatten(v as Tree, key)) out.set(kk, vv);
    else out.set(key, v);
  }
  return out;
}

export const placeholders = (s: string) =>
  [...s.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1]).sort();
export const tags = (s: string) =>
  [...s.matchAll(/<\/?(\d+)\s*\/?>/g)].map((m) => m[0].replace(/\s/g, "")).sort();

export function pluralCategories(locale: string): string[] {
  return new Intl.PluralRules(locale).resolvedOptions().pluralCategories as string[];
}

/** Groups plural keys by base: "cart.items_one" -> base "cart.items". */
function split(keys: Iterable<string>) {
  const plain = new Set<string>();
  const plural = new Map<string, Set<string>>();
  for (const k of keys) {
    const m = PLURAL_RE.exec(k);
    if (m) {
      const set = plural.get(m[1]!) ?? new Set<string>();
      set.add(m[2]!);
      plural.set(m[1]!, set);
    } else plain.add(k);
  }
  return { plain, plural };
}

const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function checkLocale(locale: string, files: LocaleFiles, english: LocaleFiles): string[] {
  const problems: string[] = [];
  const need = pluralCategories(locale);
  for (const ns of NAMESPACES) {
    const en = english[ns];
    const loc = files[ns];
    if (!en) {
      problems.push(`en/${ns}.json is missing`);
      continue;
    }
    if (!loc) {
      problems.push(`${locale}/${ns}.json is missing`);
      continue;
    }
    const enFlat = flatten(en);
    const locFlat = flatten(loc);
    const e = split(enFlat.keys());
    const l = split(locFlat.keys());
    const where = (k: string) => `${locale}/${ns}.json "${k}"`;

    for (const k of e.plain) if (!l.plain.has(k)) problems.push(`${where(k)}: missing`);
    for (const k of l.plain)
      if (!e.plain.has(k)) problems.push(`${where(k)}: not in English (extra key)`);
    for (const base of e.plural.keys())
      if (!l.plural.has(base)) problems.push(`${where(base)}: missing plural forms`);
    for (const [base, cats] of l.plural) {
      if (!e.plural.has(base)) {
        problems.push(`${where(base)}: plural key not in English (extra key)`);
        continue;
      }
      const missing = need.filter((c) => !cats.has(c));
      const extra = [...cats].filter((c) => !need.includes(c));
      if (missing.length)
        problems.push(`${where(base)}: missing plural form(s) ${missing.join(", ")} for ${locale}`);
      if (extra.length)
        problems.push(
          `${where(base)}: plural form(s) ${extra.join(", ")} don't exist in ${locale}`,
        );
    }

    // Values: non-empty strings with the same placeholders/tags as English.
    for (const [k, v] of locFlat) {
      if (typeof v !== "string" || !v.trim()) {
        problems.push(`${where(k)}: empty or not text`);
        continue;
      }
      const m = PLURAL_RE.exec(k);
      const enKey = m ? (enFlat.has(`${m[1]}_other`) ? `${m[1]}_other` : k) : k;
      const ref = enFlat.get(enKey);
      if (typeof ref !== "string") continue;
      // Plural forms may drop {{count}} (e.g. "one item" written out), never add others.
      const refPh = placeholders(ref).filter((p) => !(m && p === "count"));
      const ph = placeholders(v).filter((p) => !(m && p === "count"));
      if (!same(refPh, ph))
        problems.push(
          `${where(k)}: placeholders ${JSON.stringify(ph)} differ from English ${JSON.stringify(refPh)}`,
        );
      if (!same(tags(ref), tags(v)))
        problems.push(
          `${where(k)}: tags ${JSON.stringify(tags(v))} differ from English ${JSON.stringify(tags(ref))}`,
        );
    }
  }
  return problems;
}

/** Every locale vs English, plus "each listed locale has a folder" and vice versa. */
export function checkAll(all: Record<string, LocaleFiles>, listed: readonly string[]): string[] {
  const problems: string[] = [];
  const english = all["en"];
  if (!english) return ["src/locales/en is missing"];
  for (const code of listed)
    if (!all[code]) problems.push(`src/locales/${code}/ is missing (listed in LOCALES)`);
  for (const code of Object.keys(all))
    if (!listed.includes(code)) problems.push(`src/locales/${code}/ exists but isn't in LOCALES`);
  // English itself must have valid plural forms for English.
  for (const code of listed) if (all[code]) problems.push(...checkLocale(code, all[code], english));
  return problems;
}
