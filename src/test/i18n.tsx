/** Test helpers: real translation files, loaded synchronously. */
import type { ReactNode } from "react";
import { NAMESPACES, type Locale } from "@/i18n/locales";
import type { LocaleResources, TranslationTree } from "@/i18n/load";
import { I18nProvider } from "@/i18n/react";

const files = import.meta.glob<TranslationTree>(
  ["../locales/*/*.json", "!../locales/*/meta.json"],
  { eager: true, import: "default" },
);

/** Every namespace of one locale, straight from src/locales/<code>/. */
export function resourcesFor(locale: Locale): LocaleResources {
  return Object.fromEntries(
    NAMESPACES.map((ns) => {
      const file = files[`../locales/${locale}/${ns}.json`];
      if (!file) throw new Error(`Missing src/locales/${locale}/${ns}.json`);
      return [ns, file];
    }),
  ) as LocaleResources;
}

export const englishResources = resourcesFor("en");

/** Render children in a given language (default English). */
export function WithLocale({ locale = "en", children }: { locale?: Locale; children: ReactNode }) {
  return (
    <I18nProvider locale={locale} resources={resourcesFor(locale)}>
      {children}
    </I18nProvider>
  );
}
