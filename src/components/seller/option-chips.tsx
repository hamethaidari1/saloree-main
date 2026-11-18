import { useId, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  addOption,
  addOptionMessage,
  colorSwatch,
  MAX_COLORS,
  MAX_SIZES,
  type OptionKind,
} from "@/lib/product-options";

/**
 * Colors or sizes as removable chips. Type a value and press Enter or a
 * comma (pasting "S, M, L" adds three), or pick a suggestion / preset.
 * No duplicates (case-insensitive), trimmed, within the database limits.
 */
export function OptionChips({
  kind,
  label,
  values,
  onChange,
  suggestions,
  presets,
  error,
}: {
  kind: OptionKind;
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  /** One-click values (e.g. the common colors). */
  suggestions?: readonly string[];
  /** Named groups added at once (e.g. "Clothing" → XS…XXL). */
  presets?: readonly { label: string; values: readonly string[] }[];
  /** A message from the form's validation. */
  error?: string | undefined;
}) {
  const id = useId();
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const max = kind === "color" ? MAX_COLORS : MAX_SIZES;
  const message = problem ?? error ?? null;

  const add = (input: string) => {
    const r = addOption(values, input, kind);
    onChange(r.list);
    if (r.ok) {
      setDraft("");
      setProblem(null);
    } else if (r.reason !== "empty") setProblem(addOptionMessage(r.reason, kind));
  };
  const addMany = (list: readonly string[]) => {
    let next = values;
    let refused: string | null = null;
    for (const v of list) {
      const r = addOption(next, v, kind);
      next = r.list;
      if (!r.ok && r.reason === "full") refused = addOptionMessage("full", kind);
    }
    onChange(next);
    setProblem(refused);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };
  const remaining = (suggestions ?? []).filter(
    (s) => !values.some((v) => v.toLowerCase() === s.toLowerCase()),
  );

  return (
    <div className="seller-field option-chips">
      <label htmlFor={`${id}-input`} className="text-sm font-medium">
        {label}
      </label>
      {values.length > 0 && (
        <ul className="option-chip-list" aria-label={`${label}: ${values.length} of ${max}`}>
          {values.map((v) => {
            const swatch = kind === "color" ? colorSwatch(v) : null;
            return (
              <li key={v} className="option-chip">
                {swatch && (
                  <span className="option-swatch" style={{ background: swatch }} aria-hidden />
                )}
                <span dir="auto">{v}</span>
                <button
                  type="button"
                  className="option-chip-remove"
                  aria-label={`Remove ${v}`}
                  onClick={() => onChange(values.filter((x) => x !== v))}
                >
                  <X size={12} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Input
        id={`${id}-input`}
        value={draft}
        placeholder={
          kind === "color" ? "Type a color and press Enter" : "Type a size and press Enter"
        }
        aria-invalid={!!message}
        aria-describedby={message ? `${id}-error` : `${id}-hint`}
        disabled={values.length >= max}
        onChange={(e) => {
          // A pasted "S, M, L" becomes three chips.
          if (e.target.value.includes(",")) add(e.target.value);
          else setDraft(e.target.value);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => draft.trim() && add(draft)}
      />
      {(remaining.length > 0 || !!presets?.length) && values.length < max && (
        <div className="option-suggestions" role="group" aria-label={`Quick add: ${label}`}>
          {presets?.map((p) => (
            <button
              key={p.label}
              type="button"
              className="option-suggestion"
              onClick={() => addMany(p.values)}
            >
              + {p.label}
            </button>
          ))}
          {remaining.map((s) => {
            const swatch = kind === "color" ? colorSwatch(s) : null;
            return (
              <button key={s} type="button" className="option-suggestion" onClick={() => add(s)}>
                {swatch && (
                  <span className="option-swatch" style={{ background: swatch }} aria-hidden />
                )}
                {s}
              </button>
            );
          })}
        </div>
      )}
      {message ? (
        <p id={`${id}-error`} className="seller-error" role="alert">
          {message}
        </p>
      ) : (
        <p id={`${id}-hint`} className="seller-hint">
          Optional. Up to {max}. Buyers must choose one before adding to the bag.
        </p>
      )}
    </div>
  );
}
