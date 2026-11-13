/**
 * Locally bundled fonts (@fontsource), loaded on demand: only the fonts a
 * template actually uses are downloaded. No external font CDN and no
 * seller-provided font URLs.
 */
import type { FontKey } from "./settings";

const loaders: Record<Exclude<FontKey, "system">, () => Promise<unknown>> = {
  inter: () =>
    Promise.all([import("@fontsource/inter/400.css"), import("@fontsource/inter/700.css")]),
  poppins: () =>
    Promise.all([import("@fontsource/poppins/400.css"), import("@fontsource/poppins/700.css")]),
  playfair: () =>
    Promise.all([
      import("@fontsource/playfair-display/400.css"),
      import("@fontsource/playfair-display/700.css"),
    ]),
  merriweather: () =>
    Promise.all([
      import("@fontsource/merriweather/400.css"),
      import("@fontsource/merriweather/700.css"),
    ]),
  lora: () => Promise.all([import("@fontsource/lora/400.css"), import("@fontsource/lora/700.css")]),
};

const loaded = new Map<FontKey, Promise<unknown>>();

/** Loads a font once per page (browser only). "system" needs nothing. */
export function loadFont(key: FontKey): Promise<unknown> {
  if (key === "system" || typeof window === "undefined") return Promise.resolve();
  const existing = loaded.get(key);
  if (existing) return existing;
  const p = loaders[key]().catch(() => loaded.delete(key));
  loaded.set(key, p);
  return p;
}
