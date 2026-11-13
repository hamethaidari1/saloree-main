import { Trans, useTranslation } from "react-i18next";
import { useCountryName } from "@/i18n/hooks";
import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Check, ChevronDown, MapPin, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COUNTRIES, useCountry, type CountryCode } from "@/lib/country";
import type { DeliveryCountryCode } from "@/lib/countries";
import { readDismissedAt, saveDismissedAt, shouldSuggestCountry } from "@/lib/country-suggest";

/** The country buttons; shared by the header popover and the mobile drawer. */
export function CountryList({ onSelect }: { onSelect?: (code: CountryCode) => void }) {
  const { t } = useTranslation("nav");
  const countryName = useCountryName();
  const { country, setCountry } = useCountry();
  return (
    <ul className="grid gap-0.5" aria-label={t("deliver.countries")}>
      {COUNTRIES.map((c) => {
        const selected = country?.code === c.code;
        return (
          <li key={c.code}>
            <button
              type="button"
              className="nav-panel-link"
              aria-pressed={selected}
              onClick={() => {
                setCountry(c.code);
                onSelect?.(c.code);
              }}
            >
              {countryName(c.code)}
              {selected && <Check size={15} aria-hidden />}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Whether this chip should offer the detected country. Client only (after
 * hydration), only for the chip that is actually visible (desktop block or
 * mobile strip), never with a saved choice or on buying/account pages.
 */
function useCountrySuggestion(chip: RefObject<HTMLElement | null>) {
  const { country, detected } = useCountry();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [client, setClient] = useState<{ visible: boolean; dismissedAt: number | null } | null>(
    null,
  );
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const measure = () =>
      setClient((prev) => ({
        visible: !!chip.current && chip.current.getClientRects().length > 0,
        dismissedAt: prev ? prev.dismissedAt : readDismissedAt(),
      }));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [chip]);

  const code =
    client && client.visible && !closed
      ? shouldSuggestCountry({
          saved: country?.code ?? null,
          detected,
          dismissedAt: client.dismissedAt,
          now: Date.now(),
          pathname,
        })
      : null;
  const close = useCallback(() => setClosed(true), []);
  return { code, close };
}

/**
 * "Deliver to Türkiye?" — a small, non-blocking dialog under the chip
 * (desktop) or a bottom sheet (mobile). Focus moves in when it opens and back
 * to the chip when it closes; Esc closes it.
 */
function CountrySuggestion({
  code,
  variant,
  onAccept,
  onOther,
  onClose,
}: {
  code: DeliveryCountryCode;
  variant: "block" | "strip";
  onAccept: () => void;
  onOther: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation("nav");
  const countryName = useCountryName();
  const name = countryName(code);
  const titleId = useId();
  const textId = useId();
  const primary = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Focus moves in once, when the offer appears.
  useEffect(() => {
    primary.current?.focus({ preventScroll: true });
  }, []);
  // Esc closes it from anywhere on the page (it never traps focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={textId}
      className="country-suggest"
      data-variant={variant}
    >
      <button
        type="button"
        className="country-suggest-close"
        aria-label={t("deliver.suggestClose")}
        onClick={onClose}
      >
        <X aria-hidden />
      </button>
      <div className="country-suggest-head">
        <span className="country-suggest-icon" aria-hidden>
          <MapPin />
        </span>
        <h2 id={titleId}>{t("deliver.suggestTitle", { country: name })}</h2>
      </div>
      <p id={textId}>{t("deliver.suggestText")}</p>
      <div className="country-suggest-actions">
        <Button ref={primary} onClick={onAccept}>
          {t("deliver.suggestAccept", { country: name })}
        </Button>
        <Button variant="outline" onClick={onOther}>
          {t("deliver.suggestOther")}
        </Button>
      </div>
    </div>
  );
}

/**
 * "Deliver to" control. `block` = two-line block in the desktop header row;
 * `strip` = one line ("Deliver to Turkey ⌄") in the mobile strip.
 */
export function DeliverTo({ variant = "block" }: { variant?: "block" | "strip" }) {
  const { t } = useTranslation("nav");
  const countryName = useCountryName();
  const { country, ready, setCountry } = useCountry();
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  const suggestion = useCountrySuggestion(chip);
  const name = country ? countryName(country.code) : ready ? t("deliver.choose") : "…";

  const { close } = suggestion;
  const finish = useCallback(
    (dismiss: boolean) => {
      if (dismiss) saveDismissedAt();
      close();
      chip.current?.focus({ preventScroll: true });
    },
    [close],
  );

  return (
    <div className="deliver-anchor">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          ref={chip}
          className={variant === "strip" ? "nav-hit nav-strip-hit" : "nav-hit"}
          aria-label={t("deliver.aria", {
            country: country ? countryName(country.code) : t("deliver.noneSelected"),
          })}
        >
          {variant === "strip" ? (
            <>
              <MapPin size={18} aria-hidden className="shrink-0" />
              <span className="truncate">
                <Trans
                  t={t}
                  i18nKey="deliver.strip"
                  values={{ name }}
                  components={{ 1: <span className="font-semibold" /> }}
                />
              </span>
              <ChevronDown size={15} aria-hidden className="shrink-0" />
            </>
          ) : (
            <>
              <MapPin size={18} aria-hidden className="mt-2 shrink-0" />
              <span className="text-start">
                <span className="nav-small">{t("deliver.label")}</span>
                <span className="nav-strong">{name}</span>
              </span>
            </>
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-3">
          <h2 className="mb-1 px-2 text-sm font-semibold">{t("deliver.title")}</h2>
          <p className="mb-2 px-2 text-xs text-muted-foreground">{t("deliver.hint")}</p>
          <CountryList onSelect={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
      {suggestion.code && (
        <CountrySuggestion
          code={suggestion.code}
          variant={variant}
          onAccept={() => {
            setCountry(suggestion.code!);
            finish(false);
          }}
          onOther={() => {
            // Not a choice yet, but the offer has been seen: don't repeat it.
            saveDismissedAt();
            suggestion.close();
            setOpen(true);
          }}
          onClose={() => finish(true)}
        />
      )}
    </div>
  );
}
