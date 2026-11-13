/**
 * Loads one locale's translations. Every JSON file is a separate lazy chunk,
 * so a visitor only downloads their own language. The root `beforeLoad` calls
 * this on the server (the HTML arrives already translated) and again in the
 * browser before hydration, for the same language (read back from <html lang>
 * or the cookie), so the page never flashes English or mismatches.
 */
import { DEFAULT_LOCALE, NAMESPACES, type Locale, type Namespace } from "./locales";

/** A translation file: nested objects of strings (plain JSON, so it can travel with the page). */
export type TranslationTree = { [key: string]: string | TranslationTree };
export type LocaleResources = Record<Namespace, TranslationTree>;

// New locale folders are picked up automatically. meta.json (review status) is
// for the team only and never shipped to the browser.
const files = import.meta.glob<{ default: TranslationTree }>([
  "../locales/*/*.json",
  "!../locales/*/meta.json",
]);

const cache = new Map<Locale, Promise<LocaleResources>>();

export function loadLocaleResources(locale: Locale): Promise<LocaleResources> {
  let hit = cache.get(locale);
  if (!hit) {
    hit = Promise.all(
      NAMESPACES.map(async (ns) => {
        const load = files[`../locales/${locale}/${ns}.json`];
        if (!load) throw new Error(`Missing translations: src/locales/${locale}/${ns}.json`);
        return [ns, (await load()).default] as const;
      }),
    ).then((entries) => Object.fromEntries(entries) as LocaleResources);
    // A failed load must not stick in the cache.
    hit.catch(() => cache.delete(locale));
    cache.set(locale, hit);
  }
  return hit;
}

/** For tests and the default: English is always loadable. */
export const loadDefaultResources = () => loadLocaleResources(DEFAULT_LOCALE);
