/**
 * One-time: re-saves the photos uploaded before in-browser shrinking existed.
 *
 *   npm install --no-save sharp                                   (once)
 *   node --env-file=.env scripts/optimize-existing-images.ts      (dry run: changes nothing)
 *   node --env-file=.env scripts/optimize-existing-images.ts --apply
 *
 * For every product photo, store logo/banner and homepage content image in
 * this project's public storage: download it, make the same files the app now
 * makes on upload (`<name>.opt.webp`, longest side 1600 / 1920 / 512 px, plus
 * `<name>.thumb.webp`, 480 px), upload them next to the original, check that
 * the new file is really there, and only then point the database row at it.
 * Originals are kept (never deleted). Already-optimized URLs are skipped, so
 * running it again is safe.
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL) and, for --apply,
 * SUPABASE_SERVICE_ROLE_KEY (never commit it). A dry run without the service
 * key uses VITE_SUPABASE_PUBLISHABLE_KEY and only sees public rows.
 */
import { createClient } from "@supabase/supabase-js";
import {
  isOptimizedUrl,
  optimizedName,
  PRESETS,
  QUALITY,
  THUMB_MAX,
  THUMB_QUALITY,
  thumbName,
  type ImagePreset,
} from "../src/lib/image-optimize.ts";

const APPLY = process.argv.includes("--apply");
const URL_BASE = (process.env["SUPABASE_URL"] ?? process.env["VITE_SUPABASE_URL"] ?? "").replace(
  /\/+$/,
  "",
);
const SERVICE = process.env["SUPABASE_SERVICE_ROLE_KEY"];
const KEY = SERVICE ?? process.env["VITE_SUPABASE_PUBLISHABLE_KEY"];
const MIN_SIDE = 640;

if (!URL_BASE || !KEY) {
  console.error("Set SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (APPLY && !SERVICE) {
  console.error("--apply needs SUPABASE_SERVICE_ROLE_KEY (the publishable key can't update rows).");
  process.exit(1);
}

type Sharp = (
  input: Buffer,
  opts?: object,
) => {
  rotate(): ReturnType<Sharp>;
  resize(o: object): ReturnType<Sharp>;
  webp(o: object): ReturnType<Sharp>;
  toBuffer(o: {
    resolveWithObject: true;
  }): Promise<{ data: Buffer; info: { width: number; height: number } }>;
  metadata(): Promise<{ width?: number; height?: number }>;
};
let sharp: Sharp;
try {
  sharp = ((await import("sharp")) as unknown as { default: Sharp }).default;
} catch {
  console.error("This script needs sharp. Run: npm install --no-save sharp");
  process.exit(1);
}

const db = createClient(URL_BASE, KEY, { auth: { persistSession: false } });
const PUBLIC = `${URL_BASE}/storage/v1/object/public/`;

/** Where each image URL is used (table, row, column) and how to size it. */
interface Use {
  table: string;
  id: string;
  column: string;
}
const found = new Map<string, { preset: ImagePreset; uses: Use[] }>();
const note = (url: unknown, preset: ImagePreset, use: Use) => {
  if (typeof url !== "string" || !url.startsWith(PUBLIC) || isOptimizedUrl(url)) return;
  const entry = found.get(url) ?? { preset, uses: [] };
  entry.uses.push(use);
  found.set(url, entry);
};

async function rows(table: string, columns: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .range(from, from + 999);
    if (error) {
      console.warn(`  ${table}: skipped (${error.code ?? ""} ${error.message})`);
      return out;
    }
    out.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if ((data ?? []).length < 1000) return out;
  }
}

console.log(`${APPLY ? "APPLY" : "DRY RUN (nothing is changed)"} — ${URL_BASE}`);
if (!SERVICE) console.log("No service key: only rows visible to the public are listed.");

for (const r of await rows("products", "id, featured_image"))
  note(r["featured_image"], "product", {
    table: "products",
    id: String(r["id"]),
    column: "featured_image",
  });
for (const r of await rows("product_images", "id, image_url"))
  note(r["image_url"], "product", {
    table: "product_images",
    id: String(r["id"]),
    column: "image_url",
  });
for (const r of await rows("stores", "id, logo_url, banner_url")) {
  note(r["logo_url"], "logo", { table: "stores", id: String(r["id"]), column: "logo_url" });
  note(r["banner_url"], "banner", { table: "stores", id: String(r["id"]), column: "banner_url" });
}
for (const table of ["hero_slides", "promo_banners"])
  for (const r of await rows(table, "id, image_url"))
    note(r["image_url"], "banner", { table, id: String(r["id"]), column: "image_url" });

console.log(`${found.size} image(s) to optimize.\n`);

/** The same steps as the browser: orientation, size, WebP, quality/size down to the target. */
async function encode(input: Buffer, preset: ImagePreset) {
  const p = PRESETS[preset];
  const meta = await sharp(input, { failOn: "none" }).rotate().metadata();
  let longest = Math.min(p.max, Math.max(meta.width ?? p.max, meta.height ?? p.max));
  let best: Buffer | null = null;
  for (let round = 0; round < 8; round++) {
    for (const q of [QUALITY, QUALITY - 0.08, QUALITY - 0.16, QUALITY - 0.24]) {
      const { data } = await sharp(input, { failOn: "none" })
        .rotate()
        .resize({ width: longest, height: longest, fit: "inside", withoutEnlargement: true })
        .webp({ quality: Math.round(Math.max(0.4, q) * 100) })
        .toBuffer({ resolveWithObject: true });
      if (!best || data.length < best.length) best = data;
      if (data.length <= p.targetBytes) return data;
    }
    if (longest <= MIN_SIDE) break;
    longest = Math.max(MIN_SIDE, Math.round(longest * 0.85));
  }
  return best!;
}

const thumbOf = async (input: Buffer) =>
  (
    await sharp(input, { failOn: "none" })
      .rotate()
      .resize({ width: THUMB_MAX, height: THUMB_MAX, fit: "inside", withoutEnlargement: true })
      .webp({ quality: Math.round(THUMB_QUALITY * 100) })
      .toBuffer({ resolveWithObject: true })
  ).data;

const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
let before = 0;
let after = 0;
let done = 0;
let failed = 0;

for (const [url, { preset, uses }] of found) {
  const rel = decodeURIComponent(url.slice(PUBLIC.length).split(/[?#]/)[0] ?? "");
  const bucket = rel.split("/")[0]!;
  const path = rel.slice(bucket.length + 1);
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const base = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  const at = (name: string) => (dir ? `${dir}/${name}` : name);
  const mainPath = at(optimizedName(base, "webp"));
  const thumbPath = at(thumbName(base, "webp"));
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download ${res.status}`);
    const input = Buffer.from(await res.arrayBuffer());
    const [main, thumb] = await Promise.all([encode(input, preset), thumbOf(input)]);
    before += input.length;
    after += main.length;
    console.log(
      `${mb(input.length)} MB → ${mb(main.length)} MB (+${(thumb.length / 1024).toFixed(0)} KB thumb)  ${bucket}/${path}  [${uses.map((u) => `${u.table}.${u.column}`).join(", ")}]`,
    );
    if (!APPLY) {
      done++;
      continue;
    }
    const opts = { contentType: "image/webp", upsert: true, cacheControl: "31536000" };
    const t = await db.storage.from(bucket).upload(thumbPath, thumb, opts);
    if (t.error) throw t.error;
    const m = await db.storage.from(bucket).upload(mainPath, main, opts);
    if (m.error) throw m.error;
    const newUrl = db.storage.from(bucket).getPublicUrl(mainPath).data.publicUrl;
    // Only point rows at files that really exist (both of them).
    const [h1, h2] = await Promise.all([
      fetch(newUrl, { method: "HEAD" }),
      fetch(db.storage.from(bucket).getPublicUrl(thumbPath).data.publicUrl, { method: "HEAD" }),
    ]);
    if (!h1.ok || !h2.ok) throw new Error(`new files not reachable (${h1.status}/${h2.status})`);
    for (const u of uses) {
      // Only if the row still has the old URL (nobody changed it meanwhile).
      const { error } = await db
        .from(u.table)
        .update({ [u.column]: newUrl })
        .eq("id", u.id)
        .eq(u.column, url);
      if (error) throw new Error(`${u.table} ${u.id}: ${error.message}`);
    }
    done++;
  } catch (e) {
    failed++;
    console.warn(`  FAILED ${bucket}/${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log(
  `\n${APPLY ? "Optimized" : "Would optimize"} ${done} image(s), ${failed} failed. ` +
    `${mb(before)} MB → ${mb(after)} MB (${mb(before - after)} MB saved per full download).`,
);
if (!APPLY && done)
  console.log("Nothing was changed. Run again with --apply to upload and update.");
