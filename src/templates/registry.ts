/**
 * Template registry: database `store_templates.code` → component + defaults.
 * Unknown or inactive codes fall back to Classic.
 */
import type { ComponentType } from "react";
import { mergeSettings, type ThemeSettings } from "./settings";
import {
  BoldTemplate,
  BoutiqueTemplate,
  ClassicTemplate,
  EditorialTemplate,
  MarketTemplate,
} from "./storefronts";
import type { TemplateProps } from "./types";

export interface TemplateDefinition {
  code: string;
  label: string;
  Storefront: ComponentType<TemplateProps>;
  /** Every allowed key, so a template always renders fully. */
  defaults: ThemeSettings;
}

const shared = {
  hero_title: "",
  hero_subtitle: "",
  hero_cta_label: "Shop now",
  announcement_text: "",
  hero_image_url: "",
  show_announcement: false,
  show_featured: true,
  show_categories: true,
  show_about: true,
} as const;

export const TEMPLATES = {
  classic: {
    code: "classic",
    label: "Classic",
    Storefront: ClassicTemplate,
    defaults: {
      ...shared,
      primary: "#1F4E4A",
      accent: "#E2433F",
      background: "#FFFFFF",
      text: "#1E2B2A",
      font_heading: "inter",
      font_body: "inter",
      corner_style: "rounded",
      grid_columns: 4,
    },
  },
  boutique: {
    code: "boutique",
    label: "Boutique",
    Storefront: BoutiqueTemplate,
    defaults: {
      ...shared,
      hero_cta_label: "Discover the collection",
      primary: "#3D2C29",
      accent: "#B08968",
      background: "#FBF8F4",
      text: "#2B2220",
      font_heading: "playfair",
      font_body: "lora",
      corner_style: "square",
      grid_columns: 3,
    },
  },
  market: {
    code: "market",
    label: "Market",
    Storefront: MarketTemplate,
    defaults: {
      ...shared,
      hero_cta_label: "Shop all",
      primary: "#0F5C8C",
      accent: "#B45309",
      background: "#F5F7FA",
      text: "#111827",
      font_heading: "system",
      font_body: "system",
      corner_style: "rounded",
      grid_columns: 4,
    },
  },
  editorial: {
    code: "editorial",
    label: "Editorial",
    Storefront: EditorialTemplate,
    defaults: {
      ...shared,
      hero_cta_label: "Read & shop",
      primary: "#111111",
      accent: "#C2410C",
      background: "#FFFFFF",
      text: "#1A1A1A",
      font_heading: "merriweather",
      font_body: "inter",
      corner_style: "square",
      grid_columns: 3,
    },
  },
  bold: {
    code: "bold",
    label: "Bold",
    Storefront: BoldTemplate,
    defaults: {
      ...shared,
      hero_cta_label: "Shop now",
      primary: "#111111",
      accent: "#FACC15",
      background: "#FFFFFF",
      text: "#0A0A0A",
      font_heading: "poppins",
      font_body: "poppins",
      corner_style: "pill",
      grid_columns: 3,
    },
  },
} as const satisfies Record<string, TemplateDefinition>;

export type TemplateCode = keyof typeof TEMPLATES;
export const DEFAULT_TEMPLATE: TemplateCode = "classic";

export const isTemplateCode = (code: unknown): code is TemplateCode =>
  typeof code === "string" && Object.hasOwn(TEMPLATES, code);

/** The template for a code; unknown or inactive → Classic. */
export function getTemplate(code: unknown, isActive = true): TemplateDefinition {
  return isTemplateCode(code) && isActive ? TEMPLATES[code] : TEMPLATES[DEFAULT_TEMPLATE];
}

/** Template + merged settings for a saved theme row (or none → Classic defaults). */
export function resolveTheme(
  row: { code: string | null; isActive: boolean; settings: unknown } | null,
) {
  const template = getTemplate(row?.code ?? null, row?.isActive ?? true);
  return { template, settings: mergeSettings(template.defaults, row?.settings ?? null) };
}
