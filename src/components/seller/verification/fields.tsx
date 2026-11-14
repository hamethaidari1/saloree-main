import { useId, useMemo, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  COUNTRY_OPTIONS,
  countryNameEn,
  EU_EEA_CH_GB_COUNTRIES,
  EU_EEA_COUNTRIES,
} from "@/lib/iso-countries";

/** Label, control, hint and inline error, wired up for screen readers. */
export function Field({
  id,
  label,
  optional,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  optional?: boolean | undefined;
  hint?: ReactNode;
  error?: string | undefined;
  children: (aria: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
  }) => ReactNode;
}) {
  const described = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="seller-field">
      <label htmlFor={id} className="verify-label">
        {label}
        {optional && <span className="verify-optional"> (optional)</span>}
      </label>
      {children({ id, "aria-invalid": !!error, "aria-describedby": described || undefined })}
      {hint && (
        <p id={`${id}-hint`} className="seller-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="seller-error">
          {error}
        </p>
      )}
    </div>
  );
}

let options: { code: string; name: string }[] | null = null;
const countryOptions = () => (options ??= COUNTRY_OPTIONS());

/** One country (ISO-2), from a native select. */
export function CountrySelect({
  value,
  onChange,
  disabled,
  placeholder = "Choose a country",
  ...aria
}: {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean | undefined;
  placeholder?: string;
  id: string;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
}) {
  return (
    <select
      {...aria}
      className="seller-select"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {countryOptions().map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </select>
  );
}

/** Several countries: chosen ones as removable chips, the rest searchable. */
export function CountryMultiSelect({
  value,
  onChange,
  disabled,
  ...aria
}: {
  value: string[];
  onChange: (codes: string[]) => void;
  disabled?: boolean | undefined;
  id: string;
  "aria-invalid": boolean;
  "aria-describedby": string | undefined;
}) {
  const [query, setQuery] = useState("");
  const listId = useId();
  const chosen = new Set(value);
  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () =>
      countryOptions().filter(
        (c) => !q || c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q,
      ),
    [q],
  );
  const toggle = (code: string) =>
    onChange(chosen.has(code) ? value.filter((c) => c !== code) : [...value, code]);
  const add = (codes: string[]) => onChange([...new Set([...value, ...codes])]);
  return (
    <div className="verify-multi">
      {value.length > 0 && (
        <ul className="verify-chips" aria-label="Countries you ship to">
          {value.map((code) => (
            <li key={code}>
              <span>{countryNameEn(code)}</span>
              {!disabled && (
                <button
                  type="button"
                  aria-label={`Remove ${countryNameEn(code)}`}
                  onClick={() => toggle(code)}
                >
                  <X size={14} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!disabled && (
        <>
          <div className="verify-quick">
            <Button type="button" size="sm" variant="outline" onClick={() => add(EU_EEA_COUNTRIES)}>
              Add all EU and EEA
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => add(EU_EEA_CH_GB_COUNTRIES)}
            >
              Add EU, EEA, Switzerland and UK
            </Button>
            {value.length > 0 && (
              <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>
                Clear all
              </Button>
            )}
          </div>
          <Input
            {...aria}
            type="search"
            placeholder="Search countries"
            value={query}
            aria-controls={listId}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul id={listId} className="verify-country-list" aria-label="Countries">
            {matches.map((c) => (
              <li key={c.code}>
                <label>
                  <input
                    type="checkbox"
                    checked={chosen.has(c.code)}
                    onChange={() => toggle(c.code)}
                  />
                  {c.name}
                </label>
              </li>
            ))}
            {!matches.length && <li className="seller-hint">No country matches.</li>}
          </ul>
        </>
      )}
    </div>
  );
}
