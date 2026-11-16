/**
 * How many stores a seller may have. The database decides (my_store_limit,
 * the enforce_store_limit trigger, set_seller_store_limit for admins); this
 * only reads and shows it. Errors keep the database's own text.
 */
import { z } from "zod";
import { supabase } from "@/lib/supabase";

export const DEFAULT_STORE_LIMIT = 1;
export const MIN_STORE_LIMIT = 1;
export const MAX_STORE_LIMIT = 20;

export class StoreLimitError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "StoreLimitError";
  }
}
const dbError = (e: { message?: string; code?: string } | null) =>
  new StoreLimitError(e?.message || "The request was refused.", e?.code ?? null);

/** "message (code)": the database's words, never details. */
export function limitErrorText(e: unknown): string {
  const o = (e ?? {}) as { message?: unknown; code?: unknown };
  const message = typeof o.message === "string" ? o.message : "";
  if (!message) return "Something went wrong. Please try again.";
  return typeof o.code === "string" && o.code ? `${message} (${o.code})` : message;
}

export const storeLimitSchema = z.preprocess(
  (v) => (Array.isArray(v) ? v[0] : v),
  z.object({
    max_stores: z.coerce.number().int().min(0),
    used: z.coerce.number().int().min(0),
  }),
);
export type StoreLimit = z.output<typeof storeLimitSchema>;

export const limitInputSchema = z.coerce
  .number({ invalid_type_error: "Enter a whole number from 1 to 20." })
  .int("Enter a whole number from 1 to 20.")
  .min(MIN_STORE_LIMIT, "Enter a whole number from 1 to 20.")
  .max(MAX_STORE_LIMIT, "Enter a whole number from 1 to 20.");

/** Whether one more store can be created. */
export const canCreateStore = (l: StoreLimit | null | undefined) => !!l && l.used < l.max_stores;

export const storeLimitService = {
  /** The signed-in seller's limit and how many stores they have. */
  mine: async (): Promise<StoreLimit> => {
    const { data, error } = await supabase.rpc("my_store_limit");
    if (error) throw dbError(error);
    const r = storeLimitSchema.safeParse(data);
    if (!r.success) throw new StoreLimitError("my_store_limit returned an unexpected shape.", null);
    return r.data;
  },

  /** Staff: one seller's limit (no row = the default) and their store count. */
  forSeller: async (userId: string): Promise<StoreLimit> => {
    const [limit, stores] = await Promise.all([
      supabase.from("seller_store_limits").select("max_stores").eq("user_id", userId).maybeSingle(),
      supabase.from("stores").select("id", { count: "exact", head: true }).eq("owner_id", userId),
    ]);
    if (limit.error) throw dbError(limit.error);
    if (stores.error) throw dbError(stores.error);
    const row = limit.data as { max_stores?: unknown } | null;
    const max = z.coerce.number().int().min(0).safeParse(row?.max_stores);
    return {
      max_stores: row && max.success ? max.data : DEFAULT_STORE_LIMIT,
      used: stores.count ?? 0,
    };
  },

  /** Admin only (the database checks). */
  setForSeller: async (userId: string, max: unknown): Promise<void> => {
    const p_max = limitInputSchema.parse(max);
    const p_user = z.string().uuid().parse(userId);
    const { error } = await supabase.rpc("set_seller_store_limit", { p_user, p_max });
    if (error) throw dbError(error);
  },
};

export const storeLimitKeys = {
  mine: (userId: string) => ["seller", "store-limit", userId] as const,
  seller: (userId: string) => ["admin", "store-limit", userId] as const,
};
