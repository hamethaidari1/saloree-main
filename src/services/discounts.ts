import { z } from "zod";
import type { DiscountCodeRow } from "@/data/db";
import { supabase } from "@/lib/supabase";
import { expectRows, friendlyError } from "./errors";

export const DISCOUNT_CODE = /^[A-Z0-9_-]{3,32}$/;

const blankToNull = (v: unknown) =>
  v == null || (typeof v === "string" && v.trim() === "") ? null : v;

/** Form value of <input type="datetime-local"> (or ISO) → ISO string, blank → null. */
const optionalDate = z.preprocess(
  blankToNull,
  z
    .string()
    .refine((s) => !Number.isNaN(Date.parse(s)), "Enter a valid date and time.")
    .transform((s) => new Date(s).toISOString())
    .nullable(),
);

export const discountInputSchema = z
  .object({
    code: z
      .string({ required_error: "Enter a code." })
      .trim()
      .transform((s) => s.toUpperCase())
      .pipe(
        z
          .string()
          .regex(DISCOUNT_CODE, "Use 3–32 letters, numbers, dashes or underscores (no spaces)."),
      ),
    type: z.enum(["percent", "fixed"]),
    value: z.preprocess(
      (v) => (blankToNull(v) === null ? undefined : v),
      z.coerce.number({
        required_error: "Enter a value.",
        invalid_type_error: "Enter a value.",
      }),
    ),
    min_subtotal: z.preprocess(
      blankToNull,
      z.coerce.number().min(0, "Minimum order can't be negative.").nullable(),
    ),
    max_uses: z.preprocess(
      blankToNull,
      z.coerce.number().int("Use a whole number.").min(1, "At least 1 use.").nullable(),
    ),
    starts_at: optionalDate,
    ends_at: optionalDate,
    is_active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "percent" && (v.value < 1 || v.value > 100))
      ctx.addIssue({ code: "custom", path: ["value"], message: "Percent must be 1–100." });
    if (v.type === "fixed" && !(v.value > 0))
      ctx.addIssue({ code: "custom", path: ["value"], message: "Amount must be more than 0." });
    if (v.starts_at && v.ends_at && Date.parse(v.ends_at) <= Date.parse(v.starts_at))
      ctx.addIssue({ code: "custom", path: ["ends_at"], message: "End must be after the start." });
  });
export type DiscountInput = z.input<typeof discountInputSchema>;
export type DiscountValues = z.output<typeof discountInputSchema>;

export type Discount = Omit<DiscountCodeRow, "value" | "min_subtotal"> & {
  value: number;
  min_subtotal: number | null;
};

const toDiscount = (r: DiscountCodeRow): Discount => ({
  ...r,
  value: Number(r.value),
  min_subtotal: r.min_subtotal == null ? null : Number(r.min_subtotal),
});

export const discountError = (e: unknown) =>
  friendlyError(e, { "23505": "This code already exists in your store" });

/** Only these columns are ever written; store_id is insert-only, used_count never. */
const writable = (v: DiscountValues) => ({
  code: v.code,
  type: v.type,
  value: v.value,
  min_subtotal: v.min_subtotal,
  max_uses: v.max_uses,
  starts_at: v.starts_at,
  ends_at: v.ends_at,
  is_active: v.is_active,
});

/** "Active", "Scheduled", "Expired", "Used up" or "Disabled" — for the list badge. */
export function discountState(d: Discount, now = Date.now()) {
  if (!d.is_active) return "Disabled";
  if (d.max_uses != null && d.used_count >= d.max_uses) return "Used up";
  if (d.starts_at && Date.parse(d.starts_at) > now) return "Scheduled";
  if (d.ends_at && Date.parse(d.ends_at) <= now) return "Expired";
  return "Active";
}

export const discountsService = {
  list: async (storeId: string): Promise<Discount[]> => {
    const { data, error } = await supabase
      .from("discount_codes")
      .select("*")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as DiscountCodeRow[]).map(toDiscount);
  },

  create: async (storeId: string, input: DiscountInput): Promise<void> => {
    const values = discountInputSchema.parse(input);
    const { error } = await supabase
      .from("discount_codes")
      .insert({ store_id: storeId, ...writable(values) });
    if (error) throw error;
  },

  update: async (id: string, input: DiscountInput): Promise<void> => {
    const values = discountInputSchema.parse(input);
    const { data, error } = await supabase
      .from("discount_codes")
      .update(writable(values))
      .eq("id", id)
      .select("id");
    if (error) throw error;
    expectRows(data, "discount");
  },

  setActive: async (id: string, is_active: boolean): Promise<void> => {
    const { data, error } = await supabase
      .from("discount_codes")
      .update({ is_active })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    expectRows(data, "discount");
  },

  remove: async (id: string): Promise<void> => {
    const { data, error } = await supabase
      .from("discount_codes")
      .delete()
      .eq("id", id)
      .select("id");
    if (error) throw error;
    expectRows(data, "discount");
  },
};
