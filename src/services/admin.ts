import { z } from "zod";
import type {
  AppRole,
  CategoryRow,
  OrderRow,
  PlatformSettingsRow,
  ProductRow,
  ProfileRow,
  StoreRow,
} from "@/data/db";
import { supabase } from "@/lib/supabase";
import { expectRows, NotPermittedError } from "./errors";

// Every call here runs as the signed-in admin through the normal client.
// Access is enforced by RLS admin policies (has_role(auth.uid(), 'admin')),
// never by a service-role key.

export const MANAGED_ROLES = ["seller", "admin"] as const;
export type ManagedRole = (typeof MANAGED_ROLES)[number];

export const categoryInputSchema = z.object({
  name: z.string().trim().min(2, "Name needs at least 2 characters.").max(60),
  slug: z
    .string()
    .trim()
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens."),
});
export type CategoryInput = z.output<typeof categoryInputSchema>;

export const commissionSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.coerce
    .number({ required_error: "Enter a percentage.", invalid_type_error: "Enter a percentage." })
    .min(0, "Commission can't be negative.")
    .max(100, "Commission can't exceed 100%.")
    .refine(
      (n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6,
      "Use at most two decimal places.",
    ),
);

export type AdminStore = StoreRow & { ownerEmail: string | null; productCount: number };
export type AdminProduct = Pick<
  ProductRow,
  | "id"
  | "title"
  | "slug"
  | "price"
  | "stock"
  | "status"
  | "featured_image"
  | "created_at"
  | "store_id"
> & { stores: { name: string; slug: string } | null };
export type AdminUser = ProfileRow & { roles: AppRole[] };
export type AdminOrder = OrderRow & { stores: { name: string; slug: string } | null };
export interface Overview {
  storesPublished: number;
  storesDraft: number;
  productsActive: number;
  productsDraft: number;
  orders: number;
  users: number;
  sellers: number;
}

async function count(
  query: PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number> {
  const { count: n, error } = await query;
  if (error) throw error;
  return n ?? 0;
}
const head = { count: "exact", head: true } as const;

async function currentUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new NotPermittedError("Please sign in again.");
  return user.id;
}

export const adminService = {
  getOverview: async (): Promise<Overview> => {
    const [storesPublished, storesDraft, productsActive, productsDraft, orders, users, sellers] =
      await Promise.all([
        count(supabase.from("stores").select("id", head).eq("status", "published")),
        count(supabase.from("stores").select("id", head).eq("status", "draft")),
        count(supabase.from("products").select("id", head).eq("status", "active")),
        count(supabase.from("products").select("id", head).eq("status", "draft")),
        count(supabase.from("orders").select("id", head)),
        count(supabase.from("profiles").select("id", head)),
        count(supabase.from("user_roles").select("user_id", head).eq("role", "seller")),
      ]);
    return { storesPublished, storesDraft, productsActive, productsDraft, orders, users, sellers };
  },

  // --- Stores --------------------------------------------------------------
  listStores: async (): Promise<AdminStore[]> => {
    const { data, error } = await supabase
      .from("stores")
      .select("*, products(count)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    const rows = data as (StoreRow & { products: { count: number }[] })[];
    const ownerIds = [...new Set(rows.map((s) => s.owner_id))];
    const emails = new Map<string, string | null>();
    if (ownerIds.length) {
      const { data: profiles, error: pError } = await supabase
        .from("profiles")
        .select("id, email")
        .in("id", ownerIds);
      if (pError) throw pError;
      for (const p of profiles as Pick<ProfileRow, "id" | "email">[]) emails.set(p.id, p.email);
    }
    return rows.map(({ products, ...s }) => ({
      ...s,
      ownerEmail: emails.get(s.owner_id) ?? null,
      productCount: products?.[0]?.count ?? 0,
    }));
  },

  setStoreStatus: async (id: string, status: "published" | "draft") => {
    const { data, error } = await supabase
      .from("stores")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    expectRows(data, "store");
  },

  // --- Products ------------------------------------------------------------
  listProducts: async (): Promise<AdminProduct[]> => {
    const { data, error } = await supabase
      .from("products")
      .select(
        "id, title, slug, price, stock, status, featured_image, created_at, store_id, stores(name, slug)",
      )
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data as unknown as AdminProduct[];
  },

  setProductStatus: async (id: string, status: "active" | "draft") => {
    const { data, error } = await supabase
      .from("products")
      .update({ status })
      .eq("id", id)
      .select("id");
    if (error) throw error;
    expectRows(data, "product");
  },

  /** Removes the rows only; image files stay in the seller's storage folder. */
  deleteProduct: async (id: string) => {
    const { error: imgError } = await supabase.from("product_images").delete().eq("product_id", id);
    if (imgError) throw imgError;
    const { data, error } = await supabase.from("products").delete().eq("id", id).select("id");
    if (error) throw error;
    expectRows(data, "product");
  },

  // --- Categories ----------------------------------------------------------
  listCategories: async (): Promise<(CategoryRow & { productCount: number })[]> => {
    const { data, error } = await supabase
      .from("categories")
      .select("id, name, slug, created_at, products(count)")
      .order("name");
    if (error) throw error;
    return (data as (CategoryRow & { products: { count: number }[] })[]).map(
      ({ products, ...c }) => ({ ...c, productCount: products?.[0]?.count ?? 0 }),
    );
  },

  createCategory: async (input: CategoryInput) => {
    const values = categoryInputSchema.parse(input);
    const { error } = await supabase.from("categories").insert(values);
    if (error) throw error;
  },

  updateCategory: async (id: string, input: CategoryInput) => {
    const values = categoryInputSchema.parse(input);
    const { data, error } = await supabase
      .from("categories")
      .update(values)
      .eq("id", id)
      .select("id");
    if (error) throw error;
    expectRows(data, "category");
  },

  deleteCategory: async (id: string) => {
    const { data, error } = await supabase.from("categories").delete().eq("id", id).select("id");
    if (error) throw error;
    expectRows(data, "category");
  },

  // --- Users & roles ---------------------------------------------------------
  listUsers: async (): Promise<AdminUser[]> => {
    const [profiles, roles] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, email, created_at")
        .order("created_at", { ascending: false }),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    if (profiles.error) throw profiles.error;
    if (roles.error) throw roles.error;
    const byUser = new Map<string, AppRole[]>();
    for (const r of roles.data as { user_id: string; role: AppRole }[])
      byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.role]);
    return (profiles.data as ProfileRow[]).map((p) => ({ ...p, roles: byUser.get(p.id) ?? [] }));
  },

  addRole: async (userId: string, role: ManagedRole) => {
    const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
    // Already has the role → nothing to do.
    if (error && (error as { code?: string }).code !== "23505") throw error;
  },

  removeRole: async (userId: string, role: ManagedRole) => {
    if (role === "admin" && userId === (await currentUserId()))
      throw new NotPermittedError("You can't remove your own admin role.");
    const { data, error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role", role)
      .select("user_id");
    if (error) throw error;
    expectRows(data, "role");
  },

  // --- Orders ----------------------------------------------------------------
  listOrders: async (): Promise<AdminOrder[]> => {
    const { data, error } = await supabase
      .from("orders")
      .select("*, stores(name, slug)")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data as AdminOrder[];
  },

  // --- Commission ------------------------------------------------------------
  getSettings: async (): Promise<PlatformSettingsRow> => {
    const { data, error } = await supabase
      .from("platform_settings")
      .select("*")
      .eq("id", true)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("The platform settings row is missing.");
    return data as PlatformSettingsRow;
  },

  setCommission: async (value: unknown) => {
    const commission_percent = commissionSchema.parse(value);
    const { data, error } = await supabase
      .from("platform_settings")
      .update({ commission_percent })
      .eq("id", true)
      .select("id");
    if (error) throw error;
    expectRows(data, "setting");
  },
};
