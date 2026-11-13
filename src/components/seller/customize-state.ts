/**
 * Pure state helpers for the Customize editor (tested separately): what is
 * dirty, what is invalid, and exactly what to send to save_store_appearance.
 */
import type { StoreRow } from "@/data/db";
import {
  diffFromDefaults,
  mergeSettings,
  themeSettingsSchema,
  type SavedSettings,
  type SettingKey,
  type ThemeSettings,
} from "@/templates/settings";

export interface ImageDraft {
  /** A newly chosen file (uploaded on Save). */
  file: File | null;
  /** The current URL; "" = removed. */
  url: string;
}

export interface CustomizeDraft {
  /** Raw form values — may be invalid while typing (e.g. a half-typed colour). */
  settings: ThemeSettings;
  name: string;
  description: string;
  logo: ImageDraft;
  banner: ImageDraft;
}

export function draftFromSaved(store: StoreRow, settings: ThemeSettings): CustomizeDraft {
  return {
    settings: { ...settings },
    name: store.name,
    description: store.description ?? "",
    logo: { file: null, url: store.logo_url ?? "" },
    banner: { file: null, url: store.banner_url ?? "" },
  };
}

/** Field errors for the theme settings (empty when everything is valid). */
export function settingsErrors(settings: ThemeSettings): Partial<Record<SettingKey, string>> {
  const r = themeSettingsSchema.safeParse(settings);
  if (r.success) return {};
  const out: Partial<Record<SettingKey, string>> = {};
  for (const issue of r.error.issues) {
    const key = issue.path[0] as SettingKey | undefined;
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}

export function nameError(name: string) {
  const n = name.trim();
  if (n.length < 2) return "Store name needs at least 2 characters.";
  if (n.length > 80) return "Store name can be at most 80 characters.";
  return null;
}

const imageChanged = (a: ImageDraft, b: ImageDraft) => !!a.file || a.url !== b.url;

export function isDirty(draft: CustomizeDraft, baseline: CustomizeDraft) {
  return (
    JSON.stringify(draft.settings) !== JSON.stringify(baseline.settings) ||
    draft.name !== baseline.name ||
    draft.description !== baseline.description ||
    imageChanged(draft.logo, baseline.logo) ||
    imageChanged(draft.banner, baseline.banner)
  );
}

/** What the preview renders: invalid values fall back to the template defaults. */
export const previewSettings = (defaults: ThemeSettings, draft: CustomizeDraft) =>
  mergeSettings(defaults, draft.settings);

/**
 * The exact save_store_appearance arguments (minus ids). null = unchanged,
 * "" = cleared; settings = only values that differ from the template defaults.
 * `uploaded` holds URLs of files uploaded just before saving.
 */
export function buildSaveArgs(
  draft: CustomizeDraft,
  baseline: CustomizeDraft,
  defaults: ThemeSettings,
  uploaded: { logo?: string; banner?: string } = {},
): {
  settings: SavedSettings;
  name: string | null;
  description: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
} {
  const image = (d: ImageDraft, b: ImageDraft, up: string | undefined) =>
    up ?? (d.url !== b.url ? d.url : null);
  return {
    settings: diffFromDefaults(defaults, themeSettingsSchema.parse(draft.settings)),
    name: draft.name.trim() !== baseline.name ? draft.name.trim() : null,
    description:
      draft.description.trim() !== baseline.description.trim() ? draft.description.trim() : null,
    logoUrl: image(draft.logo, baseline.logo, uploaded.logo),
    bannerUrl: image(draft.banner, baseline.banner, uploaded.banner),
  };
}

/** Setting keys per editor section, for "Reset to template defaults". */
export const SECTION_KEYS = {
  colors: ["primary", "accent", "background", "text"],
  typography: ["font_heading", "font_body"],
  layout: ["grid_columns", "corner_style"],
  hero: ["hero_title", "hero_subtitle", "hero_cta_label", "hero_image_url"],
  announcement: ["show_announcement", "announcement_text"],
  sections: ["show_featured", "show_categories", "show_about"],
} as const satisfies Record<string, readonly SettingKey[]>;

export function resetSection(
  settings: ThemeSettings,
  defaults: ThemeSettings,
  section: keyof typeof SECTION_KEYS,
): ThemeSettings {
  const next: ThemeSettings = { ...settings };
  for (const key of SECTION_KEYS[section])
    (next as Record<SettingKey, unknown>)[key] = defaults[key];
  return next;
}
