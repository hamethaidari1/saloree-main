/**
 * Finance staff (Omar, finance_admin) — and admins. Read-only on orders and
 * shipments; the database allows writes only to platform_settings, carriers,
 * store templates/grants and site_settings.footer_settings.
 */
import { z } from "zod";
import type { OrderItemRow, OrderRow, PlatformSettingsRow, ProfileRow } from "@/data/db";
import { supabase } from "@/lib/supabase";
import { commissionSchema, currentUserId } from "./admin";
import { expectRows } from "./errors";

// ---------------------------------------------------------------------------
// finance_overview(p_days)
// ---------------------------------------------------------------------------
export const FINANCE_PERIODS = [7, 30, 90] as const;
export type FinancePeriod = (typeof FINANCE_PERIODS)[number];

/** Numeric columns arrive from PostgREST as strings or numbers. */
const num = z.coerce.number().finite();
const list = <T extends z.ZodTypeAny>(item: T) =>
  z
    .array(item)
    .nullish()
    .transform((v) => v ?? []);

export const financeOverviewSchema = z.object({
  days: num,
  orders_count: num,
  gross_sales: num,
  commission_total: num,
  seller_payable: num,
  discounts_given: num,
  paid_amount: num,
  cod_amount: num,
  unpaid_online_amount: num,
  cancelled_count: num,
  by_day: list(z.object({ day: z.string(), orders: num, sales: num, commission: num })),
  top_stores: list(
    z.object({ store_id: z.string(), name: z.string(), orders: num, sales: num, commission: num }),
  ),
  by_payment: list(
    z.object({
      provider: z.string(),
      payment_status: z.string(),
      orders: num,
      amount: num,
    }),
  ),
});
export type FinanceOverview = z.output<typeof financeOverviewSchema>;

export function parseFinanceOverview(data: unknown): FinanceOverview {
  const value = Array.isArray(data) && data.length === 1 ? data[0] : data;
  const parsed = financeOverviewSchema.safeParse(value);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => i.path.join(".") || "(root)"))];
    throw new Error(
      `finance_overview returned an unexpected shape (check: ${fields.slice(0, 6).join(", ")})`,
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Orders (read only)
// ---------------------------------------------------------------------------
export type FinanceOrder = OrderRow & { stores: { name: string; slug: string } | null };
export const FINANCE_ORDER_LIMIT = 1000;

export interface FinanceOrderFilter {
  status: string;
  paymentStatus: string;
  provider: string;
  storeId: string;
  /** yyyy-mm-dd, inclusive, in the viewer's time zone. */
  from: string;
  to: string;
  query: string;
}
export const EMPTY_ORDER_FILTER: FinanceOrderFilter = {
  status: "",
  paymentStatus: "",
  provider: "",
  storeId: "",
  from: "",
  to: "",
  query: "",
};

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const digits = (s: string) => s.replace(/\D/g, "");

/** Pure filter for the Orders tab. Search: customer name, phone digits or order id. */
export function filterFinanceOrders<T extends FinanceOrder>(
  orders: T[],
  f: FinanceOrderFilter,
): T[] {
  const q = f.query.trim().toLowerCase();
  const qDigits = digits(q);
  return orders.filter((o) => {
    if (f.status && o.status !== f.status) return false;
    if (f.paymentStatus && (o.payment_status ?? "pending") !== f.paymentStatus) return false;
    if (f.provider && (o.payment_provider ?? "cod") !== f.provider) return false;
    if (f.storeId && o.store_id !== f.storeId) return false;
    const day = localDay(o.created_at);
    if (f.from && day < f.from) return false;
    if (f.to && day > f.to) return false;
    if (!q) return true;
    return (
      (o.full_name ?? "").toLowerCase().includes(q) ||
      o.id.toLowerCase().includes(q.replace(/^#/, "")) ||
      (qDigits.length >= 3 && digits(o.phone ?? "").includes(qDigits))
    );
  });
}

// ---------------------------------------------------------------------------
// Company details (site_settings.footer_settings)
// ---------------------------------------------------------------------------
const optional = (max: number, label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v),
    z.string().max(max, `${label} can be at most ${max} characters.`).nullable(),
  );

export const companyDetailsSchema = z
  .object({
    legal_name: optional(120, "The legal name"),
    business_id: optional(60, "The business ID"),
    address: optional(240, "The address"),
    support_email: z.preprocess(
      (v) =>
        typeof v === "string" && v.trim() === "" ? null : typeof v === "string" ? v.trim() : v,
      z.string().email("Enter a valid email address.").max(254).nullable(),
    ),
  })
  .strict();
export type CompanyDetails = z.output<typeof companyDetailsSchema>;
export const COMPANY_KEYS = Object.keys(companyDetailsSchema.shape) as (keyof CompanyDetails)[];

/**
 * New footer_settings: only the four company keys change (an empty value
 * removes its key); every other key already stored is kept as it is.
 */
export function mergeCompanyDetails(
  current: Record<string, unknown> | null | undefined,
  values: CompanyDetails,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(current ?? {}) };
  for (const key of COMPANY_KEYS) {
    const v = values[key];
    if (v == null) delete next[key];
    else next[key] = v;
  }
  return next;
}

export function companyFromFooterSettings(fs: Record<string, unknown> | null | undefined) {
  const pick = (k: keyof CompanyDetails) => (typeof fs?.[k] === "string" ? (fs[k] as string) : "");
  return {
    legal_name: pick("legal_name"),
    business_id: pick("business_id"),
    address: pick("address"),
    support_email: pick("support_email"),
  };
}

async function readFooterSettings() {
  const { data, error } = await supabase
    .from("site_settings")
    .select("id, footer_settings")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("The site_settings row is missing in the database.");
  return data as { id: string; footer_settings: Record<string, unknown> | null };
}

export interface CommissionInfo {
  percent: number;
  updatedAt: string;
  /** Who changed it last, when that person's profile is readable. */
  updatedBy: { id: string; name: string | null; email: string | null; isMe: boolean } | null;
}

export const financeService = {
  overview: async (days: FinancePeriod): Promise<FinanceOverview> => {
    const { data, error } = await supabase.rpc("finance_overview", { p_days: days });
    if (error) throw error;
    return parseFinanceOverview(data);
  },

  listOrders: async (): Promise<FinanceOrder[]> => {
    const { data, error } = await supabase
      .from("orders")
      .select("*, stores(name, slug)")
      .order("created_at", { ascending: false })
      .limit(FINANCE_ORDER_LIMIT);
    if (error) throw error;
    return data as unknown as FinanceOrder[];
  },

  orderItems: async (orderId: string): Promise<OrderItemRow[]> => {
    const { data, error } = await supabase
      .from("order_items")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at");
    if (error) throw error;
    return data as OrderItemRow[];
  },

  getCommission: async (): Promise<CommissionInfo> => {
    const { data, error } = await supabase
      .from("platform_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("The platform settings row is missing.");
    const row = data as PlatformSettingsRow;
    let updatedBy: CommissionInfo["updatedBy"] = null;
    if (row.updated_by) {
      const me = await currentUserId().catch(() => null);
      // Finance staff can only read store owners' profiles; others show as "a staff member".
      const { data: p } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("id", row.updated_by)
        .maybeSingle();
      const profile = p as Pick<ProfileRow, "full_name" | "email"> | null;
      updatedBy = {
        id: row.updated_by,
        name: profile?.full_name ?? null,
        email: profile?.email ?? null,
        isMe: row.updated_by === me,
      };
    }
    return { percent: Number(row.commission_percent), updatedAt: row.updated_at, updatedBy };
  },

  setCommission: async (value: unknown) => {
    const commission_percent = commissionSchema.parse(value);
    const { data, error } = await supabase
      .from("platform_settings")
      .update({
        commission_percent,
        updated_by: await currentUserId(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", true)
      .select("id");
    if (error) throw error;
    expectRows(data, "setting");
  },

  getCompanyDetails: async () => {
    const row = await readFooterSettings();
    return { id: row.id, ...companyFromFooterSettings(row.footer_settings) };
  },

  /** Writes ONLY site_settings.footer_settings, merged with what is stored now. */
  saveCompanyDetails: async (input: unknown) => {
    const values = companyDetailsSchema.parse(input);
    const row = await readFooterSettings(); // fresh copy, so other keys are never lost
    const { data, error } = await supabase
      .from("site_settings")
      .update({ footer_settings: mergeCompanyDetails(row.footer_settings, values) })
      .eq("id", row.id)
      .select("id");
    if (error) throw error;
    expectRows(data, "company details");
  },
};
