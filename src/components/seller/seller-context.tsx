import { createContext, useContext, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import type { CategoryRow, StoreRow } from "@/data/db";

export interface SellerContextValue {
  user: User;
  /** The store the seller is working on (from the switcher). */
  store: StoreRow;
  stores: StoreRow[];
  setStoreId: (id: string) => void;
  categories: CategoryRow[];
  /** React Query key of the stores list, for invalidation after edits. */
  storesKey: readonly unknown[];
}

const SellerContext = createContext<SellerContextValue | undefined>(undefined);

export function SellerProvider({
  value,
  children,
}: {
  value: SellerContextValue;
  children: ReactNode;
}) {
  return <SellerContext.Provider value={value}>{children}</SellerContext.Provider>;
}

export function useSeller() {
  const ctx = useContext(SellerContext);
  if (!ctx) throw new Error("useSeller must be used inside the seller layout");
  return ctx;
}

export const SELECTED_STORE_KEY = "saloree-seller-store";
export const SIDEBAR_COLLAPSED_KEY = "saloree-seller-sidebar-collapsed";
