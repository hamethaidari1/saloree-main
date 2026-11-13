import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import type { StoreTemplateGrantRow, StoreTemplateRow } from "@/data/db";
import { supabase } from "@/lib/supabase";
import { savedSettingsSchema, type SavedSettings } from "@/templates/settings";
import { expectRows, friendlyError, NotPermittedError } from "./errors";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
const MISSING = ["PGRST205", "PGRST202", "PGRST200", "42P01", "42883"];
/** Real database message when the templates migration isn't applied yet. */
export function themeError(e: unknown): string {
  const err = e as { code?: string; message?: string } | null;
  if (err?.code && MISSING.includes(err.code))
    return `Store templates aren't set up in the database yet: ${err.message ?? err.code}`;
  return friendlyError(e, {
    "23514": "One of the values isn't allowed. Check the highlighted settings.",
    "23505": "That already exists.",
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------
export interface StoreThemeRecord {
  templateId: string;
  code: string | null;
  isActive: boolean;
  settings: unknown;
}

export const themesService = {
  /** Active templates for the library (public read). */
  listActive: async (): Promise<StoreTemplateRow[]> => {
    const { data, error } = await supabase
      .from("store_templates")
      .select("*")
      .eq("is_active", true)
      .order("sort_order");
    if (error) throw error;
    return data as StoreTemplateRow[];
  },

  /** A store's saved template + overrides; null when it has none (→ Classic). */
  getStoreTheme: async (storeId: string): Promise<StoreThemeRecord | null> => {
    const { data, error } = await supabase
      .from("store_themes")
      .select("template_id, settings, store_templates(code, is_active)")
      .eq("store_id", storeId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    type Tpl = { code: string; is_active: boolean };
    const row = data as unknown as {
      template_id: string;
      settings: unknown;
      // Many-to-one embeds come back as an object; tolerate an array too.
      store_templates: Tpl | Tpl[] | null;
    };
    const tpl = Array.isArray(row.store_templates)
      ? (row.store_templates[0] ?? null)
      : row.store_templates;
    return {
      templateId: row.template_id,
      code: tpl?.code ?? null,
      isActive: tpl?.is_active ?? false,
      settings: row.settings,
    };
  },

  /** Template ids unlocked for this store (owner and admins can read). */
  getGrants: async (storeId: string): Promise<string[]> => {
    const { data, error } = await supabase
      .from("store_template_grants")
      .select("template_id")
      .eq("store_id", storeId);
    if (error) throw error;
    return (data as { template_id: string }[]).map((g) => g.template_id);
  },
};

/**
 * For the public storefront: the saved theme, or null (→ Classic defaults)
 * when the store has none OR the theme can't be read (e.g. the templates
 * migration isn't applied yet). Shoppers never see a database error; the
 * failure is logged, and the seller's Themes page shows the real error.
 */
export async function loadThemeForStorefront(
  ensure: (q: ReturnType<typeof storeThemeQuery>) => Promise<StoreThemeRecord | null>,
  storeId: string | undefined,
): Promise<StoreThemeRecord | null> {
  if (!storeId) return null;
  try {
    return await ensure(storeThemeQuery(storeId));
  } catch (e) {
    console.warn(`Store theme unavailable, using Classic: ${themeError(e)}`);
    return null;
  }
}

export const storeThemeQuery = (storeId: string) =>
  queryOptions({
    queryKey: ["store-theme", storeId],
    queryFn: () => themesService.getStoreTheme(storeId),
    staleTime: 60_000,
  });

// ---------------------------------------------------------------------------
// Saving (the Customize "Save" button and "Use this template")
// ---------------------------------------------------------------------------
const httpsOrEmpty = z
  .string()
  .trim()
  .refine((s) => s === "" || /^https:\/\/\S+$/i.test(s), "Images must be https:// links.");

export const appearanceSchema = z.object({
  storeId: z.string().uuid(),
  templateId: z.string().uuid(),
  /** Only the values changed away from the template defaults. */
  settings: savedSettingsSchema,
  /** null = leave unchanged. */
  name: z.string().trim().min(2, "Store name needs at least 2 characters.").max(80).nullable(),
  /** null = unchanged, "" = clear. */
  description: z.string().trim().max(1000).nullable(),
  logoUrl: httpsOrEmpty.nullable(),
  bannerUrl: httpsOrEmpty.nullable(),
});
export type AppearanceInput = z.input<typeof appearanceSchema>;

export async function saveAppearance(input: AppearanceInput): Promise<void> {
  // A bad colour or unknown key is rejected here, before it reaches the database.
  const v = appearanceSchema.parse(input);
  const { error } = await supabase.rpc("save_store_appearance", {
    p_store_id: v.storeId,
    p_template_id: v.templateId,
    p_settings: v.settings satisfies SavedSettings,
    p_name: v.name,
    p_description: v.description,
    p_logo_url: v.logoUrl,
    p_banner_url: v.bannerUrl,
  });
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
export const templateAdminSchema = z.object({
  name: z.string().trim().min(2, "Name needs at least 2 characters.").max(80),
  description: z
    .string()
    .trim()
    .max(500)
    .transform((s) => s || null),
  category: z
    .string()
    .trim()
    .max(40)
    .transform((s) => s || null),
  is_premium: z.boolean(),
  /** Price in the currency's minor unit (cents); null = no price shown. */
  price_cents: z.number().int().min(0).max(10_000_000).nullable(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code like USD."),
  is_active: z.boolean(),
  sort_order: z.number().int().min(0).max(10_000),
});
export type TemplateAdminInput = z.input<typeof templateAdminSchema>;

/** "12.50" → 1250; "" → null. Throws on anything else. */
export function priceToCents(value: string): number | null {
  const s = value.trim();
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error("Enter a price like 12 or 12.50.");
  return Math.round(Number(s) * 100);
}
export const centsToPrice = (cents: number | null) =>
  cents == null ? "" : (cents / 100).toFixed(2).replace(/\.00$/, "");

export interface GrantWithNames extends StoreTemplateGrantRow {
  stores: { name: string; slug: string } | null;
  store_templates: { name: string; code: string } | null;
}

export const templatesAdminService = {
  listAll: async (): Promise<StoreTemplateRow[]> => {
    const { data, error } = await supabase.from("store_templates").select("*").order("sort_order");
    if (error) throw error;
    return data as StoreTemplateRow[];
  },
  /** Edits only the editable columns; templates are deactivated, never deleted. */
  update: async (id: string, input: TemplateAdminInput): Promise<void> => {
    const v = templateAdminSchema.parse(input);
    const { data, error } = await supabase
      .from("store_templates")
      .update(v)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    expectRows(data, "template");
  },
  listGrants: async (): Promise<GrantWithNames[]> => {
    const { data, error } = await supabase
      .from("store_template_grants")
      .select("*, stores(name, slug), store_templates(name, code)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data as GrantWithNames[];
  },
  grant: async (storeId: string, templateId: string): Promise<void> => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new NotPermittedError("Please sign in again.");
    const { error } = await supabase.from("store_template_grants").insert({
      store_id: storeId,
      template_id: templateId,
      source: "admin_grant",
      granted_by: user.id,
    });
    if (error) throw error;
  },
  revoke: async (storeId: string, templateId: string): Promise<void> => {
    const { data, error } = await supabase
      .from("store_template_grants")
      .delete()
      .eq("store_id", storeId)
      .eq("template_id", templateId)
      .select("store_id");
    if (error) throw error;
    expectRows(data, "grant");
  },
};
