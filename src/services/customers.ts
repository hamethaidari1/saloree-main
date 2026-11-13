import type { SellerCustomer } from "./seller-dashboard";

export type CustomerSort = {
  key: "full_name" | "orders_count" | "total_spent" | "last_order_at";
  dir: "asc" | "desc";
};

/** Case-insensitive match on name / email; phone matches on digits. */
export function searchCustomers(rows: SellerCustomer[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  const digits = q.replace(/\D/g, "");
  return rows.filter(
    (c) =>
      (c.full_name ?? "").toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q) ||
      (digits.length >= 3 && (c.phone ?? "").replace(/\D/g, "").includes(digits)),
  );
}

/** Stable sort; empty values always go last. */
export function sortCustomers(rows: SellerCustomer[], { key, dir }: CustomerSort) {
  const sign = dir === "asc" ? 1 : -1;
  const value = (c: SellerCustomer): string | number | null =>
    key === "full_name"
      ? (c.full_name || c.email || "").toLowerCase() || null
      : key === "last_order_at"
        ? c.last_order_at
          ? Date.parse(c.last_order_at)
          : null
        : c[key];
  return rows
    .map((row, i) => ({ row, i, v: value(row) }))
    .sort((a, b) => {
      if (a.v === null || b.v === null) return a.v === b.v ? a.i - b.i : a.v === null ? 1 : -1;
      const cmp = typeof a.v === "string" ? a.v.localeCompare(String(b.v)) : a.v - Number(b.v);
      return cmp ? cmp * sign : a.i - b.i;
    })
    .map((x) => x.row);
}
