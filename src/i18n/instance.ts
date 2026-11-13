import i18next, { type i18n as I18n, type TFunction } from "i18next";
import { initReactI18next } from "react-i18next";
import { NAMESPACES, type Locale, type Namespace } from "./locales";
import type { LocaleResources } from "./load";

/**
 * A fresh i18next instance for one locale. Never a module-level singleton:
 * on the server, concurrent requests in different languages must not share
 * state. Resources are passed in, so init is synchronous (no flash).
 */
export function createI18n(locale: Locale, resources: LocaleResources): I18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    lng: locale,
    resources: { [locale]: resources },
    ns: [...NAMESPACES],
    defaultNS: "common",
    // Every locale has every key (`npm run i18n:check`), so no fallback language
    // is loaded; a missing key would show its key name in tests, not English.
    fallbackLng: false,
    load: "currentOnly",
    initAsync: false,
    interpolation: { escapeValue: false }, // React escapes
    returnNull: false,
    react: { useSuspense: false },
  });
  return instance;
}

const fixedCache = new WeakMap<LocaleResources, I18n>();

/** A `t` for code outside React (route head(), toasts in services). */
export function fixedT(
  locale: Locale,
  resources: LocaleResources,
  ns: Namespace = "common",
): TFunction {
  let inst = fixedCache.get(resources);
  if (!inst) {
    inst = createI18n(locale, resources);
    fixedCache.set(resources, inst);
  }
  return inst.getFixedT(locale, ns);
}
