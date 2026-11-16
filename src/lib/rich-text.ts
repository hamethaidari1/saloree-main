/**
 * Product descriptions are written by sellers in light Markdown. They are
 * shown with the same safe parser as the legal pages (no HTML, no scripts),
 * and stripped to plain text where only text fits (meta tags, snippets).
 * Stored text is never changed.
 */
import { parseLegalMarkdown, plainMarkdown, type Block } from "./legal-markdown";

/** A heading longer than this was probably a heading plus its paragraph run together. */
const MAX_HEADING = 100;

/**
 * Some descriptions arrive on ONE line ("# Title Discover … ### Key Features
 * - **A:** text - **B:** text ### Why …"). Only then, line breaks are put back:
 * before "#…" heading markers, and before " - " when a list item follows
 * (bold or a capital letter). Hyphens inside words or numbers ("215chip",
 * "2-3 days", "in-stock") and " - 5%" are left alone. Text that already has
 * line breaks is shown as written.
 */
export function normalizeDescription(raw: string): string {
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (!text || text.includes("\n")) return text;
  let s = text
    // " ### Key Features" mid-text → its own block.
    .replace(/\s+(#{1,6})\s+(?=\S)/g, "\n\n$1 ")
    // " - **Bold:**" / " - Capital" → a list item (not " - 5%" or "2-3").
    .replace(/\s+-\s+(?=\*\*|\p{Lu})/gu, "\n- ");
  // A list ends where a heading begins (already a blank line); a heading that
  // runs on into its paragraph can't be split safely, so it stays a paragraph.
  s = s
    .split("\n")
    .map((line) => {
      const h = /^(#{1,6})\s+(.*)$/.exec(line);
      return h && h[2]!.length > MAX_HEADING ? h[2]! : line;
    })
    .join("\n");
  return s;
}

/** The description as blocks for the safe renderer. */
export const descriptionBlocks = (raw: string): Block[] =>
  parseLegalMarkdown(normalizeDescription(raw));

function blockText(blocks: Block[]): string[] {
  return blocks.flatMap((b) => {
    if (b.t === "h" || b.t === "p") return [plainMarkdown(b.text)];
    if (b.t === "list") return b.items.flatMap(blockText);
    if (b.t === "quote") return blockText(b.blocks);
    if (b.t === "table") return [...b.head, ...b.rows.flat()].map((c) => plainMarkdown(c));
    return [];
  });
}

/**
 * Plain text without Markdown symbols ("#", "**", "- "), cut at a word near
 * `max` characters with "…" (meta descriptions, snippets, cards).
 */
export function descriptionText(raw: string | null | undefined, max = 160): string {
  if (!raw?.trim()) return "";
  const text = blockText(descriptionBlocks(raw))
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/[.!?:…]$/.test(s) ? s : `${s}.`))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max / 2)).replace(/[\s,.;:–-]+$/, "")}…`;
}

/** Long enough to fold behind "Show more" (about 8 lines on the product page). */
export function isLongDescription(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const blocks = descriptionBlocks(raw);
  const lines = blocks.reduce(
    (n, b) =>
      n + (b.t === "list" ? b.items.length : b.t === "p" ? Math.ceil(b.text.length / 90) : 1),
    0,
  );
  return lines > 8;
}
