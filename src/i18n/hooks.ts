import { createContext, useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "@tanstack/react-router";
import type { Locale } from "./locales";
import { formatDate, formatDateTime, formatNumber, formatPrice } from "./format";
import { saveLocaleCookie } from "./request";

/** The active locale (set by I18nProvider in ./react). */
export const LocaleContext = createContext<Locale>("en");

export const useLocale = () => useContext(LocaleContext);

/** Price/number/date formatters bound to the active locale. */
export function useFormat() {
  const locale = useLocale();
  return useMemo(
    () => ({
      price: (amount: number, currency?: string | null) =>
        formatPrice(amount, locale, currency ?? undefined),
      number: (value: number, options?: Intl.NumberFormatOptions) =>
        formatNumber(value, locale, options),
      date: (value: string | number | Date, options?: Intl.DateTimeFormatOptions) =>
        formatDate(value, locale, options),
      dateTime: (value: string | number | Date) => formatDateTime(value, locale),
    }),
    [locale],
  );
}

/**
 * Category names come from the database; known slugs are translated, any
 * other (new) category shows its database name.
 */
export function useCategoryName() {
  const { t } = useTranslation("categories");
  return (slug: string, name: string) => t(slug, { defaultValue: name });
}

/**
 * Country names in the active language from Intl.DisplayNames (no
 * translation files needed); "OTHER" is our own entry.
 */
export function useCountryName() {
  const locale = useLocale();
  const { t } = useTranslation("nav");
  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: "region" });
    } catch {
      return null;
    }
  }, [locale]);
  return (code: string) => (code === "OTHER" ? t("deliver.other") : (names?.of(code) ?? code));
}

/** Applies a language: saves the cookie, then reloads route data (titles, text). */
export function useSetLocale() {
  const router = useRouter();
  return async (locale: Locale) => {
    saveLocaleCookie(locale);
    await router.invalidate();
  };
}
