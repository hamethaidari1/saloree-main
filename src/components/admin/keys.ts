/** React Query keys for the admin panel; mutations invalidate these. */
export const adminKeys = {
  all: ["admin"] as const,
  overview: ["admin", "overview"] as const,
  stores: ["admin", "stores"] as const,
  products: ["admin", "products"] as const,
  categories: ["admin", "categories"] as const,
  users: ["admin", "users"] as const,
  orders: ["admin", "orders"] as const,
  settings: ["admin", "settings"] as const,
};
