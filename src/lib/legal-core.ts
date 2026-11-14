/**
 * Legal pages: the pure parts shared by the app and `scripts/legal-check.ts`.
 * Only relative imports and zod, so Node can run it directly (type stripping).
 */
import { z } from "zod";

/** The documents the site knows about, in footer order. File: src/content/legal/<slug>.md */
export const LEGAL_SLUGS = ["terms", "privacy", "returns", "shipping", "seller-agreement"] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];
export const isLegalSlug = (v: unknown): v is LegalSlug =>
  typeof v === "string" && (LEGAL_SLUGS as readonly string[]).includes(v);

/** Every placeholder the texts may contain. Anything else in [[…]] fails the check. */
export const PLACEHOLDERS = [
  "COMPANY_NAME",
  "BUSINESS_ID",
  "COMPANY_ADDRESS",
  "SUPPORT_EMAIL",
  "COMMISSION_RATE",
  "WHO_PAYS_STRIPE_FEES",
  "Stripe",
] as const;
export type PlaceholderName = (typeof PLACEHOLDERS)[number];
export const isPlaceholder = (v: unknown): v is PlaceholderName =>
  typeof v === "string" && (PLACEHOLDERS as readonly string[]).includes(v);

/** What staff see next to a missing value, and where they set it. */
export const PLACEHOLDER_INFO: Record<PlaceholderName, { label: string; setIn: string }> = {
  COMPANY_NAME: { label: "Company name", setIn: "Admin → Finance → Company details → Legal name" },
  BUSINESS_ID: { label: "Business ID", setIn: "Admin → Finance → Company details → Business ID" },
  COMPANY_ADDRESS: {
    label: "Company address",
    setIn: "Admin → Finance → Company details → Address",
  },
  SUPPORT_EMAIL: {
    label: "Support email",
    setIn: "Admin → Finance → Company details → Support email",
  },
  COMMISSION_RATE: { label: "Commission rate", setIn: "Admin → Platform commission" },
  WHO_PAYS_STRIPE_FEES: {
    label: "Who pays the card (Stripe) fees",
    setIn: "Admin → Finance → Company details → Card fees wording",
  },
  // Always filled with the card processor's name (CARD_PROCESSOR_NAME in services/legal.ts).
  Stripe: { label: "Card processor name", setIn: "src/services/legal.ts (CARD_PROCESSOR_NAME)" },
};

/** Filled values; a missing or empty one is "not entered yet". */
export type LegalValues = Partial<Record<PlaceholderName, string>>;

/** Any [[…]] on one line, known or not. */
export const PLACEHOLDER_RE = /\[\[([^\]\n]*)\]\]/g;

export const legalFrontmatterSchema = z
  .object({
    slug: z.enum(LEGAL_SLUGS),
    title: z.string().trim().min(1, "title is empty"),
    updated: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "updated must be YYYY-MM-DD")
      .refine((d) => {
        const t = new Date(`${d}T00:00:00Z`);
        return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
      }, "updated is not a real date"),
  })
  .passthrough();
export type LegalFrontmatter = z.output<typeof legalFrontmatterSchema>;

/** `---\nkey: value\n---\nbody`. Null when the file has no frontmatter. */
export function splitFrontmatter(source: string): {
  data: Record<string, string>;
  body: string;
} | null {
  const src = source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!src.startsWith("---\n")) return null;
  const end = src.indexOf("\n---", 3);
  if (end === -1) return null;
  const after = src.slice(end + 4);
  if (after && !after.startsWith("\n")) return null;
  const data: Record<string, string> = {};
  for (const line of src.slice(4, end).split("\n")) {
    const m = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    let v = m[2]!.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    data[m[1]!] = v;
  }
  return { data, body: after.replace(/^\n/, "") };
}

/** Placeholder names used in a text (known ones, in order of first use). */
export function placeholdersIn(text: string): PlaceholderName[] {
  const found = new Set<PlaceholderName>();
  for (const m of text.matchAll(PLACEHOLDER_RE)) if (isPlaceholder(m[1])) found.add(m[1]);
  return [...found];
}

/** Unknown names and stray brackets: anything that would leak "[[" to visitors. */
export function placeholderProblems(text: string): string[] {
  const problems: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER_RE))
    if (!isPlaceholder(m[1])) problems.push(`unknown placeholder [[${m[1]}]]`);
  const rest = text.replace(PLACEHOLDER_RE, "");
  if (rest.includes("[[")) problems.push('a "[[" without a closing "]]" on the same line');
  if (rest.includes("]]")) problems.push('a "]]" without an opening "[["');
  return problems;
}

/** Problems with one file (empty = fine). `fileSlug` is the file name without ".md". */
export function checkLegalSource(fileSlug: string, source: string): string[] {
  const parts = splitFrontmatter(source);
  if (!parts) return ["missing frontmatter (---, slug, title, updated, ---)"];
  const fm = legalFrontmatterSchema.safeParse(parts.data);
  const problems = fm.success
    ? []
    : fm.error.issues.map((i) => `frontmatter ${i.path.join(".") || ""}: ${i.message}`.trim());
  if (fm.success && fm.data.slug !== fileSlug)
    problems.push(`frontmatter slug "${fm.data.slug}" does not match the file name`);
  if (!isLegalSlug(fileSlug))
    problems.push(`"${fileSlug}.md" is not one of ${LEGAL_SLUGS.join(", ")}`);
  if (!parts.body.trim()) problems.push("the document has no text");
  // The title is shown as it is; placeholders there would never be filled.
  if (fm.success && fm.data.title.includes("[[")) problems.push("placeholders in the title");
  return [...problems, ...placeholderProblems(parts.body)];
}
