/**
 * node scripts/legal-check.ts — run by `npm run build` and `npm test`.
 * Fails when a legal text in src/content/legal could leak a raw "[[" to
 * visitors: bad frontmatter, unknown placeholders, or stray brackets. With
 * every known placeholder filled, no "[[" or "]]" may be left in the text.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkLegalSource,
  LEGAL_SLUGS,
  PLACEHOLDER_RE,
  splitFrontmatter,
} from "../src/lib/legal-core.ts";

const dir = join(import.meta.dirname, "..", "src", "content", "legal");
const files = readdirSync(dir).filter((f) => f.endsWith(".md"));
const problems: string[] = [];

for (const file of files) {
  const slug = file.replace(/\.md$/, "");
  const source = readFileSync(join(dir, file), "utf8");
  for (const p of checkLegalSource(slug, source)) problems.push(`${file}: ${p}`);
  // Every value present: nothing bracketed may remain.
  const body = splitFrontmatter(source)?.body ?? source;
  const filled = body.replace(PLACEHOLDER_RE, "value");
  if (/\[\[|\]\]/.test(filled))
    problems.push(`${file}: "[[" or "]]" left after filling every value`);
}

if (problems.length) {
  console.error(`legal:check found ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
const missing = LEGAL_SLUGS.filter((s) => !files.includes(`${s}.md`));
console.log(`legal:check: ${files.length} legal text(s) OK`);
// A reminder, not a failure: a missing text simply has no page and no links.
if (missing.length) console.warn(`Not added yet (no page, no links): ${missing.join(", ")}`);
