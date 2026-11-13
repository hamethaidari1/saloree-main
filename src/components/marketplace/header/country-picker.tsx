import { Trans, useTranslation } from "react-i18next";
import { useCountryName } from "@/i18n/hooks";
import { useState } from "react";
import { Check, ChevronDown, MapPin } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COUNTRIES, useCountry, type CountryCode } from "@/lib/country";

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
 * "Deliver to" control. `block` = two-line block in the desktop header row;
 * `strip` = one line ("Deliver to Turkey ⌄") in the mobile strip.
 */
export function DeliverTo({ variant = "block" }: { variant?: "block" | "strip" }) {
  const { t } = useTranslation("nav");
  const countryName = useCountryName();
  const { country, ready } = useCountry();
  const [open, setOpen] = useState(false);
  const name = country ? countryName(country.code) : ready ? t("deliver.choose") : "…";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
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
  );
}
