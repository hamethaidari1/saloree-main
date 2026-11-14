/**
 * The legal texts, bundled at build time: put `terms.md`, `privacy.md`,
 * `returns.md`, `shipping.md` and `seller-agreement.md` in this folder.
 * Each starts with frontmatter (slug, title, updated: YYYY-MM-DD).
 *
 * A page and its links appear only for a file that is here, so nothing links
 * to a missing page. `node scripts/legal-check.ts` (run by `npm run build` and
 * `npm test`) fails on bad frontmatter or unknown [[PLACEHOLDERS]].
 */
export const LEGAL_SOURCES: Record<string, string> = import.meta.glob<string>("./*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});
