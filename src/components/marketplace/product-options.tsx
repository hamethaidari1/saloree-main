import { useRef, type KeyboardEvent } from "react";
import { useTranslation } from "react-i18next";
import { colorSwatch, type OptionKind } from "@/lib/product-options";

/**
 * "Color" / "Size" as a row of pill buttons (a radio group: arrow keys move
 * and choose, Tab leaves the group). The choice is highlighted; colors with a
 * known name get a swatch.
 */
export function OptionPicker({
  kind,
  values,
  value,
  onChange,
  invalid = false,
  errorId,
}: {
  kind: OptionKind;
  values: readonly string[];
  value: string | null;
  onChange: (value: string) => void;
  invalid?: boolean;
  /** The id of the "Please select…" message, when it is shown. */
  errorId?: string | undefined;
}) {
  const { t } = useTranslation("product");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const labelId = `option-${kind}-label`;
  const selected = values.indexOf(value ?? "");
  // The chosen pill, else the first, is the one Tab lands on.
  const focusable = selected >= 0 ? selected : 0;

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const rtl = getComputedStyle(e.currentTarget).direction === "rtl";
    const step =
      e.key === "ArrowDown" || e.key === (rtl ? "ArrowLeft" : "ArrowRight")
        ? 1
        : e.key === "ArrowUp" || e.key === (rtl ? "ArrowRight" : "ArrowLeft")
          ? -1
          : 0;
    const to = e.key === "Home" ? 0 : e.key === "End" ? values.length - 1 : step ? i + step : null;
    if (to === null) return;
    e.preventDefault();
    const next = (to + values.length) % values.length;
    refs.current[next]?.focus();
    onChange(values[next]!);
  };

  return (
    <div className="option-picker" data-invalid={invalid || undefined}>
      <p className="option-label" id={labelId}>
        {t(`options.${kind}`)}
        {value && (
          <span className="option-current" dir="auto">
            {" "}
            {value}
          </span>
        )}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-required="true"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        className="option-pills"
      >
        {values.map((v, i) => {
          const swatch = kind === "color" ? colorSwatch(v) : null;
          const checked = v === value;
          return (
            <button
              key={v}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={i === focusable ? 0 : -1}
              className="option-pill"
              data-kind={kind}
              onClick={() => onChange(v)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              {swatch && (
                <span className="option-swatch" style={{ background: swatch }} aria-hidden />
              )}
              <span dir="auto">{v}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "Color: Black · Size: M" under an item's title (nothing when none was chosen). */
export function SelectedOptions({
  color,
  size,
  className = "selected-options",
}: {
  color?: string | null | undefined;
  size?: string | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation("product");
  if (!color && !size) return null;
  return (
    <span className={className} data-testid="selected-options">
      {color && <span dir="auto">{t("options.colorValue", { value: color })}</span>}
      {color && size && <span aria-hidden> · </span>}
      {size && <span dir="auto">{t("options.sizeValue", { value: size })}</span>}
    </span>
  );
}
