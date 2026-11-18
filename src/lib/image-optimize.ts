/**
 * Shrinks a photo in the browser before it is uploaded, so the original
 * (often 2–3 MB) never reaches storage:
 *  - decoded with the camera's EXIF orientation applied, redrawn on a canvas
 *    (which drops every bit of metadata: location, camera, …);
 *  - the longest side at most 1600 px (products), 1920 px (banners, hero,
 *    chat photos) or 512 px (logos), never enlarged;
 *  - WebP at quality 0.82, or JPEG where the browser can't write WebP;
 *  - quality, then size, stepped down until the file is within its target;
 *  - plus a small thumbnail (480 px, quality 0.75) for cards and lists.
 *
 * Naming (no database change): the optimized file is `<id>.opt.webp` and its
 * thumbnail `<id>.thumb.webp` in the same folder. Only files with ".opt." in
 * the name have a thumbnail, so older photos simply keep their one URL.
 */

export const MAX_INPUT_BYTES = 15 * 1024 * 1024;
export const QUALITY = 0.82;
export const THUMB_MAX = 480;
export const THUMB_QUALITY = 0.75;
/** Never shrink below this while chasing the size target (keeps photos usable). */
const MIN_SIDE = 640;

export type ImagePreset = "product" | "banner" | "logo" | "attachment";
export const PRESETS: Record<ImagePreset, { max: number; targetBytes: number; thumb: boolean }> = {
  product: { max: 1600, targetBytes: 300 * 1024, thumb: true },
  banner: { max: 1920, targetBytes: 500 * 1024, thumb: true },
  logo: { max: 512, targetBytes: 150 * 1024, thumb: true },
  attachment: { max: 1920, targetBytes: 500 * 1024, thumb: false },
};

export type OptimizeProblem = "notImage" | "tooLarge" | "unreadable" | "encodeFailed";
export class ImageOptimizeError extends Error {
  // Plain fields (no parameter properties): scripts run this file with Node's type stripping.
  readonly problem: OptimizeProblem;
  readonly fileName: string;
  constructor(problem: OptimizeProblem, fileName: string) {
    super(optimizeMessage(problem, fileName));
    this.name = "ImageOptimizeError";
    this.problem = problem;
    this.fileName = fileName;
  }
}

/** Friendly English (seller and staff screens are English). */
export function optimizeMessage(problem: OptimizeProblem, name: string) {
  switch (problem) {
    case "notImage":
      return `${name}: this isn't an image. Use PNG, JPG, WebP or GIF.`;
    case "tooLarge":
      return `${name}: the photo is over 15 MB. Choose a smaller one.`;
    case "unreadable":
      return `${name}: this image couldn't be opened. Try saving it again as JPG or PNG.`;
    case "encodeFailed":
      return `${name}: this image couldn't be prepared for upload. Try another file.`;
  }
}

/** The size that fits inside max×max, keeping the aspect ratio; never larger than the original. */
export function fitWithin(width: number, height: number, max: number) {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export type OutputMime = "image/webp" | "image/jpeg";
export const extFor = (mime: OutputMime) => (mime === "image/webp" ? "webp" : "jpg");

/** How images are read and written; the browser's canvas by default (replaceable in tests). */
export interface ImageCodec {
  decode(
    file: Blob,
  ): Promise<{ width: number; height: number; source: unknown; close?: () => void }>;
  encode(
    source: unknown,
    size: { width: number; height: number },
    mime: OutputMime,
    quality: number,
  ): Promise<Blob>;
}

export interface OptimizedImage {
  main: Blob;
  thumb: Blob | null;
  mime: OutputMime;
  ext: "webp" | "jpg";
  width: number;
  height: number;
}

/**
 * Encodes at `size`, lowering the quality, then the size, until the file is
 * within `target` (or the smallest allowed step is reached).
 */
async function encodeWithin(
  codec: ImageCodec,
  source: unknown,
  original: { width: number; height: number },
  start: { width: number; height: number },
  mime: OutputMime,
  quality: number,
  target: number,
) {
  let size = start;
  let best: { blob: Blob; size: typeof size } | null = null;
  for (let round = 0; round < 8; round++) {
    for (const q of [quality, quality - 0.08, quality - 0.16, quality - 0.24]) {
      const blob = await codec.encode(source, size, mime, Math.max(0.4, q));
      if (!best || blob.size < best.blob.size) best = { blob, size };
      if (blob.size <= target) return { blob, size };
    }
    const longest = Math.max(size.width, size.height);
    if (longest <= MIN_SIDE) break;
    size = fitWithin(
      original.width,
      original.height,
      Math.max(MIN_SIDE, Math.round(longest * 0.85)),
    );
  }
  return best!;
}

export async function optimizeImage(
  file: File,
  preset: ImagePreset,
  codec: ImageCodec = browserCodec,
): Promise<OptimizedImage> {
  const name = file.name || "image";
  if (!file.type.startsWith("image/") || file.type === "image/svg+xml")
    throw new ImageOptimizeError("notImage", name);
  if (file.size > MAX_INPUT_BYTES) throw new ImageOptimizeError("tooLarge", name);
  const p = PRESETS[preset];

  let decoded: Awaited<ReturnType<ImageCodec["decode"]>>;
  try {
    decoded = await codec.decode(file);
  } catch {
    throw new ImageOptimizeError("unreadable", name);
  }
  try {
    const original = { width: decoded.width, height: decoded.height };
    if (!(original.width > 0 && original.height > 0))
      throw new ImageOptimizeError("unreadable", name);
    const size = fitWithin(original.width, original.height, p.max);

    // WebP when the browser can write it (canvas silently returns PNG otherwise).
    let mime: OutputMime = "image/webp";
    const probe = await codec.encode(decoded.source, size, mime, QUALITY);
    if (probe.type !== "image/webp") mime = "image/jpeg";
    const main =
      mime === "image/webp" && probe.size <= p.targetBytes
        ? { blob: probe, size }
        : await encodeWithin(codec, decoded.source, original, size, mime, QUALITY, p.targetBytes);

    const thumb = p.thumb
      ? await codec.encode(
          decoded.source,
          fitWithin(original.width, original.height, THUMB_MAX),
          mime,
          THUMB_QUALITY,
        )
      : null;
    if (main.blob.type !== mime || (thumb && thumb.type !== mime))
      throw new ImageOptimizeError("encodeFailed", name);
    return { main: main.blob, thumb, mime, ext: extFor(mime), ...main.size };
  } catch (e) {
    if (e instanceof ImageOptimizeError) throw e;
    throw new ImageOptimizeError("encodeFailed", name);
  } finally {
    decoded.close?.();
  }
}

// ---------------------------------------------------------------------------
// Names and URLs
// ---------------------------------------------------------------------------
export const optimizedName = (id: string, ext: string) => `${id}.opt.${ext}`;
export const thumbName = (id: string, ext: string) => `${id}.thumb.${ext}`;

const OPT_RE = /\.opt\.(webp|jpg)(?=$|[?#])/;

/** The thumbnail of an optimized image (cards, lists); any other URL is returned as it is. */
export function thumbUrl<T extends string | null | undefined>(url: T): T {
  return (typeof url === "string" ? url.replace(OPT_RE, ".thumb.$1") : url) as T;
}

/**
 * onError for an <img> showing a thumbnail: switch to the full image once
 * (in case a thumbnail is missing), never loop.
 */
export const thumbOrFull =
  (full: string | null | undefined) => (e: { currentTarget: HTMLImageElement }) => {
    const img = e.currentTarget;
    if (full && img.getAttribute("src") !== full) img.src = full;
  };

/** Whether a URL is already one of ours (the re-save script skips it). */
export const isOptimizedUrl = (url: string) => OPT_RE.test(url);

// ---------------------------------------------------------------------------
// The browser's codec
// ---------------------------------------------------------------------------
async function decodeInBrowser(file: Blob) {
  if (typeof createImageBitmap === "function") {
    // "from-image": the photo's EXIF orientation is applied (a phone photo stays upright).
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    return {
      width: bitmap.width,
      height: bitmap.height,
      source: bitmap,
      close: () => bitmap.close(),
    };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight, source: img };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function encodeInBrowser(
  source: unknown,
  size: { width: number; height: number },
  mime: OutputMime,
  quality: number,
): Promise<Blob> {
  const draw = (ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) => {
    // JPEG has no transparency: a white background instead of black.
    if (mime === "image/jpeg") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size.width, size.height);
    }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source as CanvasImageSource, 0, 0, size.width, size.height);
  };
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2D canvas");
    draw(ctx);
    return canvas.convertToBlob({ type: mime, quality });
  }
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2D canvas");
  draw(ctx);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), mime, quality),
  );
}

export const browserCodec: ImageCodec = { decode: decodeInBrowser, encode: encodeInBrowser };
