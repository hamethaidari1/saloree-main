/**
 * Brand, colors and sizes of a product: the limits (the same as the
 * database's), normalization for the seller's chip inputs, and the buyer's
 * selection. Stock stays one number per product, shared by every option.
 *
 * The buyer's choice is only a request: `place_order` checks on the server
 * that it is one of the product's own values (exact match) and refuses the
 * order otherwise ("Please choose a valid color and size for each item").
 */
import { z } from "zod";

export const MAX_BRAND = 80;
export const MAX_COLORS = 20;
export const MAX_COLOR_LENGTH = 30;
export const MAX_SIZES = 30;
export const MAX_SIZE_LENGTH = 20;

export type OptionKind = "color" | "size";
const LIMITS: Record<OptionKind, { max: number; maxLength: number }> = {
  color: { max: MAX_COLORS, maxLength: MAX_COLOR_LENGTH },
  size: { max: MAX_SIZES, maxLength: MAX_SIZE_LENGTH },
};

export const COLOR_SUGGESTIONS = [
  "Black",
  "White",
  "Red",
  "Blue",
  "Green",
  "Yellow",
  "Pink",
  "Purple",
  "Orange",
  "Brown",
  "Grey",
  "Beige",
  "Gold",
  "Silver",
] as const;

export const SIZE_PRESETS = {
  clothing: ["XS", "S", "M", "L", "XL", "XXL"],
  shoes: ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46"],
  oneSize: ["One size"],
} as const satisfies Record<string, readonly string[]>;

/** A swatch for the common color names (any language's own name shows as a plain pill). */
const SWATCHES: Record<string, string> = {
  black: "#111111",
  white: "#ffffff",
  red: "#d32f2f",
  blue: "#1e63d6",
  navy: "#1f2a52",
  green: "#2e7d32",
  yellow: "#f6c90e",
  pink: "#f06fa4",
  purple: "#7b3fb3",
  orange: "#f57c00",
  brown: "#7b4b2a",
  grey: "#8a8a8a",
  gray: "#8a8a8a",
  beige: "#e8dcc2",
  gold: "#c9a227",
  silver: "#c0c4c8",
};
export const colorSwatch = (name: string): string | null =>
  SWATCHES[name.trim().toLowerCase()] ?? null;

/** Trim and collapse inner whitespace: "  Light   blue " → "Light blue". */
export const cleanOption = (value: string) => value.trim().replace(/\s+/g, " ");

/**
 * The list as the database accepts it: cleaned, no blanks, no duplicates
 * (case-insensitive; the first spelling wins), each within the length limit
 * and at most `max` values.
 */
export function normalizeOptions(values: readonly string[], kind: OptionKind): string[] {
  const { max, maxLength } = LIMITS[kind];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const v = cleanOption(raw);
    const key = v.toLowerCase();
    if (!v || v.length > maxLength || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

export type AddResult =
  | { ok: true; list: string[] }
  | { ok: false; list: string[]; reason: "empty" | "tooLong" | "duplicate" | "full" };

/** Adding one chip (typed, pasted with commas, or a suggestion). */
export function addOption(list: readonly string[], input: string, kind: OptionKind): AddResult {
  const { max, maxLength } = LIMITS[kind];
  const parts = input.split(",").map(cleanOption).filter(Boolean);
  if (!parts.length) return { ok: false, list: [...list], reason: "empty" };
  let next = [...list];
  for (const v of parts) {
    if (v.length > maxLength) return { ok: false, list: next, reason: "tooLong" };
    if (next.some((x) => x.toLowerCase() === v.toLowerCase()))
      return { ok: false, list: next, reason: "duplicate" };
    if (next.length >= max) return { ok: false, list: next, reason: "full" };
    next = [...next, v];
  }
  return { ok: true, list: next };
}

/** Seller-facing message for a refused chip (the seller area is English). */
export function addOptionMessage(
  reason: Exclude<AddResult, { ok: true }>["reason"],
  kind: OptionKind,
) {
  const { max, maxLength } = LIMITS[kind];
  const what = kind === "color" ? "color" : "size";
  switch (reason) {
    case "empty":
      return `Type a ${what} first.`;
    case "tooLong":
      return `A ${what} can be at most ${maxLength} characters.`;
    case "duplicate":
      return `That ${what} is already in the list.`;
    case "full":
      return `You can add at most ${max} ${what}s.`;
  }
}

const optionList = (kind: OptionKind) => {
  const { max, maxLength } = LIMITS[kind];
  const what = kind === "color" ? "color" : "size";
  return z
    .array(z.string())
    .default([])
    .transform((list) => list.map(cleanOption).filter(Boolean))
    .pipe(
      z
        .array(z.string().max(maxLength, `A ${what} can be at most ${maxLength} characters.`))
        .max(max, `Add at most ${max} ${what}s.`)
        .refine(
          (list) => new Set(list.map((v) => v.toLowerCase())).size === list.length,
          `Each ${what} can be added only once.`,
        ),
    );
};
export const colorsSchema = optionList("color");
export const sizesSchema = optionList("size");
export const brandSchema = z
  .string()
  .nullish()
  .transform((v) => (v ? cleanOption(v) : ""))
  .pipe(z.string().max(MAX_BRAND, `The brand can be at most ${MAX_BRAND} characters.`))
  .transform((v) => v || null);

// ---------------------------------------------------------------------------
// The buyer's selection
// ---------------------------------------------------------------------------
export interface ProductOptions {
  colors?: readonly string[] | null | undefined;
  sizes?: readonly string[] | null | undefined;
}
export interface Selection {
  color?: string | null | undefined;
  size?: string | null | undefined;
}

export const hasOptions = (p: ProductOptions) => !!p.colors?.length || !!p.sizes?.length;

/** Which choices are still missing (or no longer valid): "color", "size". */
export function missingOptions(p: ProductOptions, s: Selection): OptionKind[] {
  const out: OptionKind[] = [];
  if (p.colors?.length && !(s.color && p.colors.includes(s.color))) out.push("color");
  if (p.sizes?.length && !(s.size && p.sizes.includes(s.size))) out.push("size");
  return out;
}

/**
 * The selection the server will accept: each value exactly one of the
 * product's own, and nothing for an option the product doesn't have.
 * Null when a required choice is missing or unknown.
 */
export function validSelection(
  p: ProductOptions,
  s: Selection,
): { color: string | null; size: string | null } | null {
  if (missingOptions(p, s).length) return null;
  const color = p.colors?.length ? (s.color ?? null) : null;
  const size = p.sizes?.length ? (s.size ?? null) : null;
  if (!p.colors?.length && s.color) return null;
  if (!p.sizes?.length && s.size) return null;
  return { color, size };
}

/** The product-ns key of the inline "Please select…" message for what is missing. */
export function missingMessageKey(missing: readonly OptionKind[]) {
  if (missing.includes("color") && missing.includes("size")) return "options.chooseBoth";
  return missing.includes("color") ? "options.chooseColor" : "options.chooseSize";
}

/** The cart line's identity: the same product in another color or size is another line. */
export const lineKey = (l: { productId: string; color?: string | null; size?: string | null }) =>
  JSON.stringify([l.productId, l.color ?? null, l.size ?? null]);
