/**
 * npm run i18n:check — fails when any locale differs from English in keys,
 * placeholders, <n> tags or plural forms. Runs directly in Node (type stripping).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkAll, type LocaleFiles } from "../src/i18n/check.ts";
import { LOCALES, NAMESPACES } from "../src/i18n/locales.ts";

const root = join(import.meta.dirname, "..", "src", "locales");
const all: Record<string, LocaleFiles> = {};
for (const code of readdirSync(root)) {
  const dir = join(root, code);
  if (!statSync(dir).isDirectory()) continue;
  const files: LocaleFiles = {};
  for (const ns of NAMESPACES) {
    try {
      files[ns] = JSON.parse(readFileSync(join(dir, `${ns}.json`), "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error(`${code}/${ns}.json: ${(e as Error).message}`);
    }
  }
  all[code] = files;
}

const problems = checkAll(
  all,
  LOCALES.map((l) => l.code),
);
// Every locale folder needs meta.json with a boolean `reviewed` (team-only, never shipped).
const unreviewed: string[] = [];
for (const { code } of LOCALES) {
  try {
    const meta = JSON.parse(readFileSync(join(root, code, "meta.json"), "utf8")) as {
      reviewed?: unknown;
    };
    if (typeof meta.reviewed !== "boolean")
      problems.push(`${code}/meta.json: "reviewed" must be true or false`);
    else if (!meta.reviewed) unreviewed.push(code);
  } catch {
    problems.push(`${code}/meta.json is missing or not valid JSON`);
  }
}

if (problems.length) {
  console.error(`i18n:check found ${problems.length} problem(s):\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`i18n:check: ${LOCALES.length} locales × ${NAMESPACES.length} files OK`);
// A reminder, not a failure: see src/locales/README.md for the review checklist.
if (unreviewed.length)
  console.warn(`Not yet reviewed by a native speaker: ${unreviewed.join(", ")}`);
