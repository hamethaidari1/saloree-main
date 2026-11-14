/**
 * A small, safe Markdown reader for the legal pages. It produces a tree of
 * plain data that React renders as text: raw HTML is never interpreted (it is
 * shown as text, comments are dropped), only http(s), mailto, tel, in-site
 * and #anchor links are kept, and there is no way to run a script.
 *
 * Supported: # headings, paragraphs (two trailing spaces = line break),
 * - / 1. lists (nested by indentation), > quotes, --- rules, | tables,
 * **bold**, *italic*, `code`, [links](url), <https://autolinks> and [[PLACEHOLDERS]].
 */
import {
  isLegalSlug,
  isPlaceholder,
  PLACEHOLDER_RE,
  type LegalValues,
  type PlaceholderName,
} from "./legal-core";

// ---------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------
export type Inline =
  | { t: "text"; v: string }
  | { t: "br" }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] }
  /**
   * name null = an unknown placeholder (never filled). next = the character
   * that follows it in the text, looking past closing ** or * ("" at the end).
   */
  | { t: "ph"; name: PlaceholderName | null; raw: string; next: string };

export type Block =
  | { t: "h"; level: 2 | 3 | 4 | 5 | 6; text: string; id: string }
  | { t: "p"; text: string }
  | { t: "list"; ordered: boolean; start: number; items: Block[][] }
  | { t: "quote"; blocks: Block[] }
  | { t: "hr" }
  | { t: "table"; head: string[]; rows: string[][] };

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

const indentOf = (line: string) => /^ */.exec(line)![0].length;
const isBlank = (line: string) => !line.trim();

function startsBlock(line: string) {
  return HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line);
}

function cells(row: string) {
  const s = row.trim().replace(/^\|/, "").replace(/\|$/, "");
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

/** Lines → blocks. Headings get no id here (see withHeadingIds). */
function parseLines(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (isBlank(line)) {
      i++;
      continue;
    }
    const h = HEADING.exec(line);
    if (h) {
      out.push({ t: "h", level: Math.max(2, h[1]!.length) as 2, text: h[2]!.trim(), id: "" });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      out.push({ t: "hr" });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i]!)) inner.push(QUOTE.exec(lines[i++]!)![1]!);
      out.push({ t: "quote", blocks: parseLines(inner) });
      continue;
    }
    const item = ITEM.exec(line);
    if (item && indentOf(line) <= 3) {
      const base = indentOf(line);
      const ordered = /\d/.test(item[2]!);
      const items: string[][] = [];
      let content = 0;
      while (i < lines.length) {
        const l = lines[i]!;
        const m = ITEM.exec(l);
        if (m && indentOf(l) <= base + 1 && /\d/.test(m[2]!) === ordered) {
          content = m[1]!.length + m[2]!.length + 1;
          items.push([m[3]!]);
          i++;
          continue;
        }
        if (isBlank(l)) {
          // A blank line continues the list only if it goes on afterwards.
          let j = i + 1;
          while (j < lines.length && isBlank(lines[j]!)) j++;
          const next = lines[j];
          const nm = next === undefined ? null : ITEM.exec(next);
          const continues =
            next !== undefined &&
            (indentOf(next) >= Math.min(content, base + 2) ||
              (!!nm && indentOf(next) <= base + 1 && /\d/.test(nm[2]!) === ordered));
          if (!continues) break;
          items[items.length - 1]!.push("");
          i++;
          continue;
        }
        if (indentOf(l) > base) {
          items[items.length - 1]!.push(l.slice(Math.min(indentOf(l), content)));
          i++;
          continue;
        }
        // Lazy continuation of the item's paragraph — only when the item's line
        // breaks mid-sentence. A line after a finished sentence starts a new
        // paragraph ("- Last item.\nWe do not sell your data." is not one item).
        const last = items[items.length - 1]!;
        const prev = last[last.length - 1] ?? "";
        if (
          !startsBlock(l) &&
          last.length &&
          !isBlank(prev) &&
          !/[.!?:;]["'”’)*_]*\s*$/.test(prev)
        ) {
          last.push(l.trim());
          i++;
          continue;
        }
        break;
      }
      out.push({
        t: "list",
        ordered,
        start: ordered ? Number.parseInt(item[2]!, 10) : 1,
        items: items.map(parseLines),
      });
      continue;
    }
    if (line.includes("|") && TABLE_SEP.test(lines[i + 1] ?? "") && lines[i + 1]!.includes("-")) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && !isBlank(lines[i]!) && lines[i]!.includes("|")) {
        const r = cells(lines[i++]!);
        rows.push(head.map((_, k) => r[k] ?? ""));
      }
      out.push({ t: "table", head, rows });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      !isBlank(lines[i]!) &&
      (para.length === 0 || !startsBlock(lines[i]!))
    )
      para.push(lines[i++]!);
    // Two trailing spaces or a backslash = a line break; otherwise lines join with a space.
    const text = para
      .map((l, k) => {
        const hard = k < para.length - 1 && (/ {2,}$/.test(l) || /\\$/.test(l));
        const trimmed = l.trim().replace(/\\$/, "");
        return k < para.length - 1 ? trimmed + (hard ? "\n" : " ") : trimmed;
      })
      .join("");
    out.push({ t: "p", text });
  }
  return out;
}

/** "Section 2: Fees & payouts" → "section-2-fees-payouts" (stable, ASCII). */
export function slugifyHeading(text: string) {
  const s = plainMarkdown(text.replace(PLACEHOLDER_RE, ""))
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "section";
}

function withHeadingIds(blocks: Block[], used = new Map<string, number>()): Block[] {
  return blocks.map((b) => {
    if (b.t === "h") {
      const base = slugifyHeading(b.text);
      const n = used.get(base) ?? 0;
      used.set(base, n + 1);
      return { ...b, id: n ? `${base}-${n + 1}` : base };
    }
    if (b.t === "quote") return { ...b, blocks: withHeadingIds(b.blocks, used) };
    if (b.t === "list") return { ...b, items: b.items.map((it) => withHeadingIds(it, used)) };
    return b;
  });
}

/**
 * The document body → blocks. HTML comments are removed; a leading "# Title"
 * that repeats the page title is dropped (the page shows it as its <h1>).
 */
export function parseLegalMarkdown(body: string, title?: string): Block[] {
  const src = body
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\t/g, "    ");
  let blocks = parseLines(src.split("\n"));
  const first = blocks[0];
  if (
    first?.t === "h" &&
    title !== undefined &&
    plainMarkdown(first.text).trim().toLowerCase() === title.trim().toLowerCase()
  )
    blocks = blocks.slice(1);
  return withHeadingIds(blocks);
}

// ---------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------
/** Only these links are kept; anything else becomes plain text. */
export function safeHref(raw: string): string | null {
  const href = raw.trim().replace(/^<|>$/g, "");
  if (!href || /[\s"'<>]/.test(href)) return null;
  // Links between the texts ("privacy.md", "./terms.md#fees") go to the pages.
  const md = /^(?:\.\/)?([a-z-]+)\.md(#[\w-]*)?$/.exec(href);
  if (md) return isLegalSlug(md[1]) ? `/legal/${md[1]}${md[2] ?? ""}` : null;
  if (/^https?:\/\/[^/]/i.test(href)) return href;
  if (/^mailto:[^@]+@[^@]+$/i.test(href) || /^tel:\+?[\d\s().-]+$/i.test(href)) return href;
  if (href.startsWith("#") || (href.startsWith("/") && !href.startsWith("//"))) return href;
  return null;
}

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|<>~]/;

function findClosing(s: string, from: number, delim: string) {
  for (let k = from; k <= s.length - delim.length; k++) {
    if (s[k] === "\\") {
      k++;
      continue;
    }
    if (s.startsWith(delim, k) && k > from && s[k - 1] !== " ") return k;
  }
  return -1;
}

/** Matching "]" for a "[" at `open`, allowing nested brackets. */
function closeBracket(s: string, open: number) {
  let depth = 0;
  for (let k = open; k < s.length; k++) {
    if (s[k] === "\\") k++;
    else if (s[k] === "[") depth++;
    else if (s[k] === "]" && --depth === 0) return k;
  }
  return -1;
}

/** Matching ")" for a "(" at `open`, so "(https://x.com/a_(b))" stays one URL. */
function closeParen(s: string, open: number) {
  let depth = 0;
  for (let k = open; k < s.length; k++) {
    if (s[k] === "(") depth++;
    else if (s[k] === ")" && --depth === 0) return k;
  }
  return -1;
}

/** `after`: the character that follows `s` in the enclosing text (for nested **bold**). */
export function parseInline(s: string, after = ""): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => {
    if (buf) out.push({ t: "text", v: buf });
    buf = "";
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "\\" && i + 1 < s.length && ESCAPABLE.test(s[i + 1]!)) {
      buf += s[i + 1];
      i += 2;
      continue;
    }
    if (c === "\n") {
      flush();
      out.push({ t: "br" });
      i++;
      continue;
    }
    if (s.startsWith("[[", i)) {
      const m = /^\[\[([^\]\n]*)\]\]/.exec(s.slice(i));
      if (m) {
        flush();
        const end = i + m[0].length;
        out.push({
          t: "ph",
          name: isPlaceholder(m[1]) ? m[1] : null,
          raw: m[1]!,
          next: s[end] ?? after,
        });
        i = end;
        continue;
      }
    }
    if (c === "`") {
      const end = s.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({ t: "code", v: s.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (c === "<") {
      const m = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(s.slice(i));
      const href = m ? safeHref(m[1]!) : null;
      if (m && href) {
        flush();
        out.push({ t: "link", href, c: [{ t: "text", v: m[1]!.replace(/^mailto:/i, "") }] });
        i += m[0].length;
        continue;
      }
    }
    if (c === "[") {
      const close = closeBracket(s, i);
      if (close > i && s[close + 1] === "(") {
        const end = closeParen(s, close + 1);
        if (end > close) {
          flush();
          const label = parseInline(s.slice(i + 1, close), s[end + 1] ?? after);
          const href = safeHref(s.slice(close + 2, end).split(/\s+"/)[0]!);
          if (href) out.push({ t: "link", href, c: label });
          else out.push(...label); // an unsafe link keeps only its text
          i = end + 1;
          continue;
        }
      }
    }
    if (c === "*" || c === "_") {
      const strong = s[i + 1] === c;
      const delim = strong ? c + c : c;
      // "_" only at a word start, so snake_case and e-mail addresses stay as they are.
      const wordStart = c === "*" || i === 0 || !/[\p{L}\p{N}]/u.test(s[i - 1]!);
      const next = s[i + delim.length];
      if (wordStart && next && next !== " ") {
        const end = findClosing(s, i + delim.length, delim);
        if (end > -1) {
          flush();
          const inner = parseInline(s.slice(i + delim.length, end), s[end + delim.length] ?? after);
          out.push(strong ? { t: "strong", c: inner } : { t: "em", c: inner });
          i = end + delim.length;
          continue;
        }
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------
// Values: what visitors see when a detail has not been entered yet
// ---------------------------------------------------------------------------
const filled = (values: LegalValues, name: string) => isPlaceholder(name) && !!values[name]?.trim();

const hasMissing = (text: string, values: LegalValues) =>
  [...text.matchAll(PLACEHOLDER_RE)].some((m) => !filled(values, m[1]!));

const ABBREVIATION =
  /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|approx|incl|no|nos|art|sec|para|inc|ltd|co|corp|mr|mrs|ms|dr|st)\.$/i;

/** Splits a paragraph into sentences (keeping their trailing space). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  const re = /[.!?]["'”’)\]]*(\s+)/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const end = m.index + m[0].length - m[1]!.length;
    const next = text[re.lastIndex];
    if (!next || !/[\p{Lu}\p{N}"“'(*_[]/u.test(next)) continue;
    if (ABBREVIATION.test(text.slice(start, end))) continue;
    out.push(text.slice(start, re.lastIndex));
    start = re.lastIndex;
  }
  out.push(text.slice(start));
  return out.filter((s) => s.length);
}

/** A placeholder, optionally in **bold** or *italics*. */
const PH = String.raw`(\*\*|\*|__|_)?\[\[([^\]\n]*)\]\]\1?`;
/**
 * ", business ID **[[X]]**" / ", **[[X]]**": one item of a list of details
 * (a label of 0–3 words), followed only by punctuation, "(" or the end, so
 * ", write to [[X]] with the link" is never cut into nonsense.
 */
const LIST_ITEM = new RegExp(
  String.raw`,\s+(?:[\p{L}][\p{L}-]*\s+){0,3}${PH}(?=[,.;:)]|\s+\(|\s*$)`,
  "gu",
);
/** " or (to) **[[X]]**": one of several ways to do something. */
const ALTERNATIVE = new RegExp(String.raw`\s+or\s+(?:to\s+)?${PH}(?=[,.;:)]|\s|$)`, "gu");

/**
 * Takes out only the missing value where the sentence still reads well
 * without it: an item in a "·" line, an item in a comma list of details, or
 * one "or" alternative. Anything else is left for the sentence to be dropped.
 */
export function removeMissingParts(text: string, values: LegalValues): string {
  let s = text;
  if (/ · /.test(s))
    s = s
      .split(" · ")
      .filter((part) => !hasMissing(part, values))
      .join(" · ");
  const drop = (re: RegExp) =>
    (s = s.replace(re, (all: string, _d: string, name: string) =>
      filled(values, name) ? all : "",
    ));
  drop(LIST_ITEM);
  drop(ALTERNATIVE);
  return s;
}

/**
 * Drops what needs a value we don't have: first just the value where that
 * reads well (see removeMissingParts), otherwise the whole sentence.
 */
export function pruneSentences(text: string, values: LegalValues): string {
  if (!hasMissing(text, values)) return text;
  return splitSentences(text)
    .map((s) => removeMissingParts(s, values))
    .filter((s) => !hasMissing(s, values))
    .join("")
    .trim();
}

/**
 * The visitor's version: what needs a missing value is left out (a list item,
 * table row or paragraph left empty disappears, and so does a section heading
 * whose whole section went); in a heading only the placeholder is removed.
 */
export function forVisitors(blocks: Block[], values: LegalValues): Block[] {
  const pruned = pruneBlocks(blocks, values);
  // A heading whose section had text, all of which needed missing values, goes too.
  const hadText = sectionsWithText(blocks);
  return pruned.filter((b, k) => {
    if (b.t !== "h" || !hadText.has(b.id)) return true;
    const next = pruned[k + 1];
    return !!next && !(next.t === "h" && next.level <= b.level);
  });
}

function sectionsWithText(blocks: Block[]) {
  const ids = new Set<string>();
  blocks.forEach((b, k) => {
    const next = blocks[k + 1];
    if (b.t === "h" && next && !(next.t === "h" && next.level <= b.level)) ids.add(b.id);
  });
  return ids;
}

function pruneBlocks(blocks: Block[], values: LegalValues): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.t === "h") {
      if (!hasMissing(b.text, values)) out.push(b);
      else {
        const text = b.text
          .replace(PLACEHOLDER_RE, (all, name: string) => (filled(values, name) ? all : ""))
          .replace(/\s{2,}/g, " ")
          .replace(/\s+([,.:;)])/g, "$1")
          .trim();
        if (text) out.push({ ...b, text });
      }
    } else if (b.t === "p") {
      const text = pruneSentences(b.text, values);
      if (text) out.push({ ...b, text });
    } else if (b.t === "list") {
      const items = b.items.map((it) => pruneBlocks(it, values)).filter((it) => it.length);
      if (items.length) out.push({ ...b, items });
    } else if (b.t === "quote") {
      const inner = pruneBlocks(b.blocks, values);
      if (inner.length) out.push({ ...b, blocks: inner });
    } else if (b.t === "table") {
      const rows = b.rows
        .map((r) => r.map((cell) => pruneSentences(cell, values)))
        .filter((r) => r.some((cell) => cell));
      out.push({ ...b, head: b.head.map((h) => pruneSentences(h, values)), rows });
    } else out.push(b);
  }
  return out;
}

/** The text a placeholder becomes, or null when it isn't filled. */
export function placeholderText(
  node: Extract<Inline, { t: "ph" }>,
  values: LegalValues,
): string | null {
  if (!node.name) return null;
  const v = values[node.name]?.trim();
  if (!v) return null;
  // "[[COMMISSION_RATE]]%" in the text → "12%", not "12%%".
  if (node.name === "COMMISSION_RATE") return node.next === "%" ? v : `${v}%`;
  // A value saved with a final full stop ("…, Finland.") before the text's own
  // punctuation: "Finland, e-mail", not "Finland., e-mail". "Ltd., " keeps its dot.
  if (/[.,;:!?]/.test(node.next) && v.endsWith(".")) {
    const abbreviation = /\b(?:ltd|inc|co|corp|jr|sr|st|no)\.$/i.test(v);
    if (node.next === "." || !abbreviation) return v.slice(0, -1);
  }
  return v;
}

/** Plain text of inline Markdown (for meta descriptions and heading ids). */
export function plainMarkdown(s: string, values: LegalValues = {}): string {
  const walk = (nodes: Inline[]): string =>
    nodes
      .map((n) =>
        n.t === "text" || n.t === "code"
          ? n.v
          : n.t === "br"
            ? " "
            : n.t === "ph"
              ? (placeholderText(n, values) ?? "")
              : walk(n.c),
      )
      .join("");
  return walk(parseInline(s)).replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------
export interface TocEntry {
  id: string;
  text: string;
}

/** The table of contents: every top-level section (## heading). */
export function tableOfContents(blocks: Block[], values: LegalValues): TocEntry[] {
  return blocks.flatMap((b) =>
    b.t === "h" && b.level === 2 ? [{ id: b.id, text: plainMarkdown(b.text, values) }] : [],
  );
}

/** First paragraph as plain text, cut at a word near `max` characters. */
export function describe(blocks: Block[], values: LegalValues, max = 160): string {
  const first = blocks.find((b): b is Extract<Block, { t: "p" }> => b.t === "p");
  const text = first ? plainMarkdown(first.text, values) : "";
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max / 2)).replace(/[\s,.;:]+$/, "")}…`;
}

/** Known placeholders a document uses that have no value. */
export function missingIn(blocks: Block[], values: LegalValues): PlaceholderName[] {
  const missing = new Set<PlaceholderName>();
  const scan = (text: string) => {
    for (const m of text.matchAll(PLACEHOLDER_RE))
      if (isPlaceholder(m[1]) && !filled(values, m[1])) missing.add(m[1]);
  };
  const walk = (bs: Block[]) => {
    for (const b of bs) {
      if (b.t === "h" || b.t === "p") scan(b.text);
      else if (b.t === "list") b.items.forEach(walk);
      else if (b.t === "quote") walk(b.blocks);
      else if (b.t === "table") [...b.head, ...b.rows.flat()].forEach(scan);
    }
  };
  walk(blocks);
  return [...missing];
}
