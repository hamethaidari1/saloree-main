import { useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown } from "lucide-react";
import { Blocks } from "@/components/legal/legal-text";
import { descriptionBlocks, isLongDescription } from "@/lib/rich-text";

/**
 * A seller's product description as formatted text (headings, bold, lists,
 * links), through the same safe parser as the legal pages: no HTML is ever
 * interpreted. Long descriptions fold to about 8 lines.
 */
export function ProductDescription({ text }: { text: string | null | undefined }) {
  const { t } = useTranslation("product");
  const id = useId();
  const [open, setOpen] = useState(false);
  const blocks = useMemo(() => descriptionBlocks(text ?? ""), [text]);
  const long = useMemo(() => isLongDescription(text), [text]);
  if (!blocks.length) return null;
  return (
    <div className="product-description">
      <div
        id={id}
        className="product-description-body"
        dir="auto"
        data-collapsed={(long && !open) || undefined}
        data-testid="product-description"
      >
        <Blocks blocks={blocks} values={{}} viewer="content" />
      </div>
      {long && (
        <button
          type="button"
          className="product-description-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? t("showLess") : t("showMore")}
          <ChevronDown aria-hidden className={open ? "rotate-180" : undefined} size={16} />
        </button>
      )}
    </div>
  );
}
