import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { COUNTRY_OPTIONS, countryCodeForName, countryNameEn } from "@/lib/iso-countries";

let all: { code: string; name: string }[] | null = null;
const countries = () => (all ??= COUNTRY_OPTIONS());

/**
 * A searchable country picker over the official ISO 3166-1 list (combobox
 * pattern): type to filter, arrows to move, Enter or click to choose, Escape
 * to close. An exact name typed in full is chosen too.
 */
export function CountryCombobox({
  id,
  value,
  onChange,
  onBlur,
  disabled,
  invalid,
  describedBy,
  placeholder,
  noMatch,
  listLabel,
}: {
  id: string;
  /** ISO code, or "" for none. */
  value: string;
  onChange: (code: string) => void;
  onBlur?: (() => void) | undefined;
  disabled?: boolean | undefined;
  invalid?: boolean | undefined;
  describedBy?: string | undefined;
  placeholder: string;
  noMatch: string;
  listLabel: string;
}) {
  const listId = useId();
  const [text, setText] = useState(value ? countryNameEn(value) : "");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const q = text.trim().toLowerCase();
  const chosenName = value ? countryNameEn(value) : "";
  const matches = useMemo(
    () =>
      !q || q === chosenName.toLowerCase()
        ? countries()
        : countries().filter((c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase() === q),
    [q, chosenName],
  );

  const choose = (code: string) => {
    onChange(code);
    setText(countryNameEn(code));
    setOpen(false);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => {
        const n = matches.length;
        if (!n) return 0;
        return e.key === "ArrowDown" ? (a + 1) % n : (a - 1 + n) % n;
      });
    } else if (e.key === "Enter" && open && matches[active]) {
      e.preventDefault();
      choose(matches[active]!.code);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div className="country-combo">
      <input
        ref={input}
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && matches[active] ? `${listId}-${matches[active]!.code}` : undefined
        }
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="country-name"
        placeholder={placeholder}
        disabled={disabled}
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setActive(0);
          // A full name typed (or pasted, or autofilled) is chosen at once.
          const code = countryCodeForName(e.target.value);
          onChange(code ?? "");
        }}
        onKeyDown={onKey}
        onBlur={() => {
          // Leave a name only when it is a real choice.
          window.setTimeout(() => {
            setOpen(false);
            setText((t) => {
              const code = countryCodeForName(t);
              return code ? countryNameEn(code) : t;
            });
            onBlur?.();
          }, 120);
        }}
      />
      <ChevronDown className="country-combo-icon" aria-hidden />
      {open && (
        <ul id={listId} role="listbox" aria-label={listLabel} className="country-combo-list">
          {matches.length ? (
            matches.map((c, i) => (
              <li
                key={c.code}
                id={`${listId}-${c.code}`}
                role="option"
                aria-selected={c.code === value}
                data-active={i === active || undefined}
                onMouseDown={(e) => {
                  e.preventDefault(); // keep focus in the input
                  choose(c.code);
                }}
              >
                {c.name}
              </li>
            ))
          ) : (
            <li className="country-combo-empty" role="presentation">
              {noMatch}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
