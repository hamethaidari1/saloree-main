// Hand-written row shapes for the Supabase tables this app reads.
// Not generated: replace with `supabase gen types` output when available.

export type AppRole = "customer" | "seller" | "admin" | (string & {});

export interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export interface StoreRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  banner_url: string | null;
  category: string | null;
  location: string | null;
  status: "draft" | "published" | (string & {});
  created_at: string;
  updated_at: string;
}

export interface ProductRow {
  id: string;
  store_id: string;
  category_id: string | null;
  title: string;
  slug: string;
  description: string | null;
  price: number;
  compare_price: number | null;
  stock: number;
  featured_image: string | null;
  status: "active" | (string & {});
  created_at: string;
}

export interface ProfileRow {
  id: string;
  full_name: string | null;
  email: string | null;
  created_at: string;
}

/** Single-row table (id is always true); see saloree-admin-draft.sql. */
export interface PlatformSettingsRow {
  id: true;
  commission_percent: number;
  updated_at: string;
  updated_by: string | null;
}

/** public.site_settings (one row; publicly readable). Only the columns the footer reads. */
export interface SiteSettingsFooterRow {
  footer_description: string | null;
  copyright_text: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  twitter_url: string | null;
  /** Free-form JSON; legal_name / business_id / address are read from here if present. */
  footer_settings: Record<string, unknown> | null;
}

/** public.footer_links */
export interface FooterLinkRow {
  id: string;
  category: string;
  label: string;
  url: string;
  display_order: number | null;
  is_active: boolean | null;
}

export interface OrderRow {
  id: string;
  customer_id: string;
  store_id: string;
  status: string;
  subtotal: number | null;
  total: number | null;
  total_amount: number | null;
  payment_status: string | null;
  payment_provider: string | null;
  paid_at?: string | null;
  shipping_fee?: number | string | null;
  checkout_group_id: string | null;
  currency: string | null;
  discount_code: string | null;
  discount_amount: number | string | null;
  commission_percent: number | string | null;
  commission_amount: number | string | null;
  seller_amount: number | string | null;
  country: string | null;
  city: string | null;
  address: string | null;
  shipping_address: unknown;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiscountCodeRow {
  id: string;
  store_id: string;
  code: string;
  type: "percent" | "fixed";
  value: number | string;
  min_subtotal: number | string | null;
  max_uses: number | null;
  used_count: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface StoreTemplateRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  is_premium: boolean;
  price_cents: number | null;
  currency: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface StoreTemplateGrantRow {
  store_id: string;
  template_id: string;
  source: "purchase" | "admin_grant" | (string & {});
  granted_by: string | null;
  created_at: string;
}

export interface StoreThemeRow {
  store_id: string;
  template_id: string;
  /** Only the overrides that differ from the template defaults. */
  settings: unknown;
  updated_at: string;
}

export interface CarrierRow {
  id: string;
  code: string;
  name: string;
  /** e.g. "https://carrier.example/track?n={number}" */
  tracking_url_template: string | null;
  is_active: boolean;
}

export type ShipmentStatus =
  "label_created" | "in_transit" | "out_for_delivery" | "delivered" | "exception" | "returned";

/** Provider columns (reserved for automatic tracking later) are left out on purpose. */
export interface ShipmentRow {
  id: string;
  order_id: string;
  carrier_id: string | null;
  carrier_name: string | null;
  tracking_number: string;
  tracking_url: string | null;
  status: ShipmentStatus | (string & {});
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShipmentEventRow {
  id: string;
  shipment_id: string;
  status: ShipmentStatus | (string & {});
  description: string | null;
  location: string | null;
  /** "seller", "admin", "provider" (automatic tracking, later)… */
  source: string | null;
  occurred_at: string;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string;
  store_id: string;
  title: string | null;
  quantity: number;
  price: number | null;
  unit_price: number | null;
  total: number | null;
  created_at: string;
}
