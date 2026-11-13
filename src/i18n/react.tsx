import { useEffect, useMemo, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { dirFor, type Locale } from "./locales";
import type { LocaleResources } from "./load";
import { createI18n } from "./instance";
import { LocaleContext } from "./hooks";

/**
 * One i18next instance per locale per render tree (per request on the
 * server). Switching language makes a new instance from the new resources.
 */
export function I18nProvider({
  locale,
  resources,
  children,
}: {
  locale: Locale;
  resources: LocaleResources;
  children: ReactNode;
}) {
  const i18n = useMemo(() => createI18n(locale, resources), [locale, resources]);
  // The server already rendered <html lang dir>; keep it in step after a switch.
  useEffect(() => {
    const html = document.documentElement;
    html.lang = locale;
    html.dir = dirFor(locale);
  }, [locale]);
  return (
    <LocaleContext.Provider value={locale}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </LocaleContext.Provider>
  );
}
