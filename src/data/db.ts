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

export interface OrderRow {
  id: string;
  customer_id: string;
  store_id: string;
  status: string;
  subtotal: number | null;
  total: number | null;
  total_amount: number | null;
  payment_status: string | null;
  shipping_address: unknown;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
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
