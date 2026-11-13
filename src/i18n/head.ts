import type { TFunction } from "i18next";
import { DEFAULT_LOCALE, type Locale, type Namespace } from "./locales";
import type { LocaleResources } from "./load";
import { fixedT } from "./instance";

export interface I18nContext {
  locale: Locale;
  resources: LocaleResources;
}

/** The root route context's i18n (set in __root beforeLoad). */
export function i18nFromMatches(
  matches: readonly { routeId: string; context?: unknown }[],
): I18nContext | null {
  const root = matches.find((m) => m.routeId === "__root__");
  const ctx = (root?.context as { i18n?: I18nContext } | undefined)?.i18n;
  return ctx ?? null;
}

/**
 * `t` for a route's head(): page titles and meta descriptions per language.
 * Falls back to returning the key's English default only if i18n is missing
 * (which should not happen once the root has loaded).
 */
export function headT(
  matches: readonly { routeId: string; context?: unknown }[],
  ns: Namespace = "common",
): TFunction {
  const i18n = i18nFromMatches(matches);
  if (!i18n) {
    const passthrough = ((key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key) as unknown as TFunction;
    return passthrough;
  }
  return fixedT(i18n.locale ?? DEFAULT_LOCALE, i18n.resources, ns);
}
