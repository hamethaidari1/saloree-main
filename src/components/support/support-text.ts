import { useMemo } from "react";
import i18next from "i18next";
import { useTranslation } from "react-i18next";
import enSupport from "@/locales/en/support.json";
import { useLocale } from "@/i18n/hooks";
import type { Locale } from "@/i18n/locales";

/** Customers read the site's language; seller and staff screens stay English. */
export type SupportAudience = "customer" | "seller" | "staff";
export type SupportT = (key: string, options?: Record<string, unknown>) => string;

let english: SupportT | null = null;
/** A fixed English `t` for the support namespace (seller and staff screens). */
export function englishSupportT(): SupportT {
  if (!english) {
    const inst = i18next.createInstance();
    void inst.init({
      lng: "en",
      resources: { en: { support: enSupport } },
      ns: ["support"],
      defaultNS: "support",
      initAsync: false,
      interpolation: { escapeValue: false },
    });
    const t = inst.getFixedT("en", "support");
    english = (key, options) => String(t(key, options ?? {}));
  }
  return english;
}

export function useSupportText(audience: SupportAudience): { t: SupportT; locale: Locale } {
  const { t } = useTranslation("support");
  const locale = useLocale();
  return useMemo(
    () =>
      audience === "customer"
        ? {
            t: (key: string, options?: Record<string, unknown>) => String(t(key, options ?? {})),
            locale,
          }
        : { t: englishSupportT(), locale: "en" as Locale },
    [audience, t, locale],
  );
}
