import { useId, useRef, useState, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown, Globe } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LOCALES, localeInfo, shortCode, type Locale } from "@/i18n/locales";
import { useLocale, useSetLocale } from "@/i18n/hooks";

/**
 * The list of languages, each in its own name. A radiogroup with a roving
 * tab stop: arrow keys / Home / End move between languages, Space or Enter
 * (or a click) applies one. Applying saves the `lang` cookie and re-renders
 * the page in that language without a reload.
 */
export function LanguagePanel({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation("nav");
  const current = useLocale();
  const setLocale = useSetLocale();
  const titleId = useId();
  const [focusIndex, setFocusIndex] = useState(() =>
    Math.max(
      0,
      LOCALES.findIndex((l) => l.code === current),
    ),
  );
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [busy, setBusy] = useState(false);

  const choose = async (locale: Locale) => {
    if (locale !== current) {
      setBusy(true);
      try {
        await setLocale(locale);
      } finally {
        setBusy(false);
      }
    }
    onDone?.();
  };
  const move = (to: number) => {
    const i = (to + LOCALES.length) % LOCALES.length;
    setFocusIndex(i);
    refs.current[i]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const next = {
      ArrowDown: i + 1,
      ArrowRight: i + 1,
      ArrowUp: i - 1,
      ArrowLeft: i - 1,
    } as Record<string, number>;
    if (e.key in next) {
      e.preventDefault();
      move(next[e.key]!);
    } else if (e.key === "Home") {
      e.preventDefault();
      move(0);
    } else if (e.key === "End") {
      e.preventDefault();
      move(LOCALES.length - 1);
    }
  };

  return (
    <div className="lang-panel">
      <h2 id={titleId} className="lang-panel-title">
        {t("language.change")}
      </h2>
      <div role="radiogroup" aria-labelledby={titleId} aria-busy={busy} className="lang-options">
        {LOCALES.map((l, i) => {
          const checked = l.code === current;
          return (
            <button
              key={l.code}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={i === focusIndex ? 0 : -1}
              className="lang-option"
              disabled={busy}
              onClick={() => void choose(l.code)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              <span className="lang-radio" aria-hidden="true">
                {checked && <Check size={14} />}
              </span>
              <span lang={l.code} dir={l.dir}>
                {l.nativeName}
              </span>
            </button>
          );
        })}
      </div>
      <p className="lang-note">{t("language.priceNote")}</p>
    </div>
  );
}

/** Globe + "EN": opens the panel. `header` sits on the dark nav, `footer` on the dark footer. */
export function LanguageSelect({ variant = "header" }: { variant?: "header" | "footer" }) {
  const { t } = useTranslation("nav");
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={variant === "header" ? "nav-hit lang-trigger" : "footer-lang-trigger"}
        aria-label={t("language.trigger", { language: localeInfo(locale).nativeName })}
      >
        <Globe size={variant === "header" ? 18 : 16} aria-hidden />
        <span className="font-bold">{shortCode(locale)}</span>
        <ChevronDown size={14} aria-hidden />
      </PopoverTrigger>
      <PopoverContent
        // Radix/floating-ui alignment is logical: "end" is the left edge in RTL.
        align={variant === "header" ? "end" : "center"}
        side={variant === "footer" ? "top" : "bottom"}
        className="w-72 p-3"
      >
        <LanguagePanel onDone={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
