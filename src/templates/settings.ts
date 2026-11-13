/**
 * Store theme settings: the ONLY things a seller can change. Every value is
 * validated here before it can reach the page, and it reaches the page only
 * as scoped CSS variables (colours, fonts from a fixed list, radius, columns)
 * or as plain text rendered by React. Sellers can never inject CSS or HTML.
 */
import { z } from "zod";

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const FONT_KEYS = [
  "system",
  "inter",
  "poppins",
  "playfair",
  "merriweather",
  "lora",
] as const;
export const CORNER_STYLES = ["square", "rounded", "pill"] as const;
export const GRID_COLUMNS = [2, 3, 4] as const;

export type FontKey = (typeof FONT_KEYS)[number];

const color = z.string().regex(HEX_COLOR, "Use a colour like #1A2B3C.");
const httpsOrEmpty = z
  .string()
  .trim()
  .max(500, "Use a shorter link (max 500 characters).")
  .refine((s) => s === "" || /^https:\/\/\S+$/i.test(s), "The image link must start with https://");

/** One schema for every allowed key. Unknown keys are rejected (strict). */
export const themeSettingsSchema = z
  .object({
    primary: color,
    accent: color,
    background: color,
    text: color,
    font_heading: z.enum(FONT_KEYS),
    font_body: z.enum(FONT_KEYS),
    corner_style: z.enum(CORNER_STYLES),
    grid_columns: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    hero_title: z.string().max(80, "Keep the title under 80 characters."),
    hero_subtitle: z.string().max(200, "Keep the subtitle under 200 characters."),
    hero_cta_label: z.string().max(30, "Keep the button label under 30 characters."),
    announcement_text: z.string().max(120, "Keep the announcement under 120 characters."),
    hero_image_url: httpsOrEmpty,
    show_announcement: z.boolean(),
    show_featured: z.boolean(),
    show_categories: z.boolean(),
    show_about: z.boolean(),
  })
  .strict();

export type ThemeSettings = z.infer<typeof themeSettingsSchema>;
export type SettingKey = keyof ThemeSettings;
export const SETTING_KEYS = Object.keys(themeSettingsSchema.shape) as SettingKey[];

/** Saved overrides: any subset of the allowed keys, each fully validated. */
export const savedSettingsSchema = themeSettingsSchema.partial().strict();
export type SavedSettings = z.infer<typeof savedSettingsSchema>;

/**
 * Merges saved overrides over a template's defaults. Each saved key is
 * validated on its own: an unknown or invalid value is ignored (the default
 * wins), so a bad row can never break or restyle a storefront.
 * This is the ONE merge used by both the editor preview and the live store.
 */
export function mergeSettings(defaults: ThemeSettings, saved: unknown): ThemeSettings {
  const out: ThemeSettings = { ...defaults };
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return out;
  const shape = themeSettingsSchema.shape;
  for (const key of SETTING_KEYS) {
    if (!(key in saved)) continue;
    const parsed = shape[key].safeParse((saved as Record<string, unknown>)[key]);
    if (parsed.success) (out as Record<SettingKey, unknown>)[key] = parsed.data;
  }
  return out;
}

/** Only the values that differ from the template defaults (what gets saved). */
export function diffFromDefaults(defaults: ThemeSettings, settings: ThemeSettings): SavedSettings {
  const out: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) if (settings[key] !== defaults[key]) out[key] = settings[key];
  return savedSettingsSchema.parse(out);
}

// ---------------------------------------------------------------------------
// Fonts (bundled locally; see ./fonts.ts)
// ---------------------------------------------------------------------------
export const FONT_STACKS: Record<FontKey, string> = {
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  inter: '"Inter", system-ui, sans-serif',
  poppins: '"Poppins", system-ui, sans-serif',
  playfair: '"Playfair Display", Georgia, serif',
  merriweather: '"Merriweather", Georgia, serif',
  lora: '"Lora", Georgia, serif',
};
export const FONT_LABELS: Record<FontKey, string> = {
  system: "System default",
  inter: "Inter",
  poppins: "Poppins",
  playfair: "Playfair Display",
  merriweather: "Merriweather",
  lora: "Lora",
};

const RADIUS: Record<(typeof CORNER_STYLES)[number], string> = {
  square: "0px",
  rounded: "10px",
  pill: "999px",
};

/**
 * Settings → scoped CSS custom properties for the template wrapper.
 * Colours are re-checked against HEX_COLOR; anything else is a fixed map.
 */
export function themeCssVars(s: ThemeSettings): Record<`--tpl-${string}`, string> {
  const safe = (c: string, fallback: string) => (HEX_COLOR.test(c) ? c : fallback);
  return {
    "--tpl-primary": safe(s.primary, "#1F4E4A"),
    "--tpl-accent": safe(s.accent, "#E2433F"),
    "--tpl-bg": safe(s.background, "#FFFFFF"),
    "--tpl-text": safe(s.text, "#1E2B2A"),
    "--tpl-radius": RADIUS[s.corner_style] ?? RADIUS.rounded,
    // Cards/images never become fully round, even with "pill" buttons.
    "--tpl-card-radius": s.corner_style === "square" ? "0px" : "12px",
    "--tpl-font-heading": FONT_STACKS[s.font_heading] ?? FONT_STACKS.system,
    "--tpl-font-body": FONT_STACKS[s.font_body] ?? FONT_STACKS.system,
    "--tpl-grid-cols": String(GRID_COLUMNS.includes(s.grid_columns) ? s.grid_columns : 3),
  };
}

// ---------------------------------------------------------------------------
// WCAG contrast (warns in the editor; never blocks saving)
// ---------------------------------------------------------------------------
function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #RRGGBB colours (1–21), or null if invalid. */
export function contrastRatio(a: string, b: string) {
  if (!HEX_COLOR.test(a) || !HEX_COLOR.test(b)) return null;
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

export const WCAG_AA = 4.5;

/** Pairs the templates actually use: body text on background, button text (background colour) on primary. */
export function contrastWarnings(s: ThemeSettings) {
  const checks = [
    { pair: "Text on background", ratio: contrastRatio(s.text, s.background) },
    { pair: "Button text on primary colour", ratio: contrastRatio(s.background, s.primary) },
  ];
  return checks.filter((c) => c.ratio !== null && c.ratio < WCAG_AA) as {
    pair: string;
    ratio: number;
  }[];
}
