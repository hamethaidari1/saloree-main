/**
 * Makes the site icons (browser tab, Google search results, home screen) from
 * the white Saloree wordmark on a solid brand-green square, so the logo is
 * visible on both light and dark backgrounds. No transparency anywhere.
 *
 *   npm install --no-save sharp        (once; sharp is not a project dependency)
 *   node scripts/generate-favicons.ts
 *
 * Writes into public/: favicon.ico (16, 32, 48), favicon-48x48.png,
 * favicon-96x96.png, icon-192.png, icon-512.png, apple-touch-icon.png (180).
 * Re-run after the logo changes and commit the results.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const BRAND_GREEN = "#002e28";
/** The wordmark's width as a share of the square: the rest is padding, and it still fits inside a circle crop. */
const LOGO_SHARE = 0.84;

type SharpImage = {
  resize(o: object): SharpImage;
  composite(o: object[]): SharpImage;
  png(o?: object): SharpImage;
  removeAlpha(): SharpImage;
  toBuffer(): Promise<Buffer>;
};
type Sharp = (input?: Buffer | object) => SharpImage;

let sharp: Sharp;
try {
  sharp = ((await import("sharp")) as unknown as { default: Sharp }).default;
} catch {
  console.error("This script needs sharp. Run: npm install --no-save sharp");
  process.exit(1);
}

const pub = (name: string) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
const logo = await readFile(pub("logo-white.png"));

/** A size×size opaque PNG: green square, white wordmark centred. */
async function icon(size: number): Promise<Buffer> {
  const mark = await sharp(logo)
    .resize({ width: Math.round(size * LOGO_SHARE), fit: "inside" })
    .toBuffer();
  const square = await sharp({
    create: { width: size, height: size, channels: 3, background: BRAND_GREEN },
  })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toBuffer();
  // Compositing adds an alpha channel; drop it so the file is plain RGB (no transparency).
  return sharp(square).removeAlpha().png({ compressionLevel: 9 }).toBuffer();
}

/** An .ico holding PNG images (supported by every current browser and by Google). */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt8(0, 2); // no palette
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const outputs: [string, number][] = [
  ["favicon-48x48.png", 48],
  ["favicon-96x96.png", 96],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
];
for (const [name, size] of outputs) {
  const png = await icon(size);
  await writeFile(pub(name), png);
  console.log(`public/${name}  ${size}×${size}  ${png.length} bytes`);
}

const icoSizes = [48, 32, 16];
const icoFile = ico(
  await Promise.all(icoSizes.map(async (size) => ({ size, png: await icon(size) }))),
);
await writeFile(pub("favicon.ico"), icoFile);
console.log(`public/favicon.ico  ${icoSizes.join(", ")}  ${icoFile.length} bytes`);
