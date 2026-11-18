/**
 * jsdom can't decode or encode images: tests that upload photos use this
 * stand-in for the canvas (a 2000×1500 photo; the "file" size follows the
 * pixels and quality). The real resizing is tested in image-optimize.test.tsx
 * and was checked in a real browser.
 *
 *   vi.mock("@/lib/image-optimize", async (orig) =>
 *     (await import("./fake-image")).withFakeCodec(await orig()));
 */
import type { ImageCodec } from "@/lib/image-optimize";

export const fakeCodec: ImageCodec = {
  decode: async () => ({ width: 2000, height: 1500, source: null }),
  encode: async (_source, size, mime, quality) =>
    new Blob([new Uint8Array(Math.max(1, Math.round(size.width * size.height * 0.02 * quality)))], {
      type: mime,
    }),
};

export function withFakeCodec<M extends typeof import("@/lib/image-optimize")>(real: M): M {
  return {
    ...real,
    optimizeImage: (file, preset, codec) => real.optimizeImage(file, preset, codec ?? fakeCodec),
  };
}
