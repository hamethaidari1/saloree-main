import { useId } from "react";
import { ChevronDown, Globe } from "lucide-react";

/** Only English is live; RTL languages are listed so the markup is ready for them. */
export const LANGUAGES = [
  { code: "en", label: "English", dir: "ltr", enabled: true },
  { code: "fa", label: "فارسی", dir: "rtl", enabled: false },
  { code: "ps", label: "پښتو", dir: "rtl", enabled: false },
] as const;

export function LanguageSelect({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const id = useId();
  return (
    <div className="relative flex items-center">
      <label htmlFor={id} className="sr-only">
        Language
      </label>
      <Globe size={16} aria-hidden className="pointer-events-none absolute start-2" />
      <select
        id={id}
        value="en"
        // Nothing to switch to yet; the other options are disabled.
        onChange={() => {}}
        className={
          tone === "dark"
            ? "nav-lang nav-focus ps-7"
            : "nav-lang ps-7 text-foreground border border-input focus-visible:outline-2 focus-visible:outline-ring"
        }
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} lang={l.code} dir={l.dir} disabled={!l.enabled}>
            {l.enabled ? l.label : `${l.label} — Coming soon`}
          </option>
        ))}
      </select>
      <ChevronDown size={14} aria-hidden className="pointer-events-none absolute end-1.5" />
    </div>
  );
}
