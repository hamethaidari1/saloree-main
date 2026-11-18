import { useTranslation } from "react-i18next";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { defaultCartStorage, type CartStorage } from "@/lib/cartStorage";
import { lineKey, normalizeCart, updateCart, type CartItem, type CartLine } from "@/services/cart";
import type { Selection } from "@/lib/product-options";
import { catalogQuery } from "@/services/catalog";
interface CartContextValue {
  items: CartItem[];
  ready: boolean;
  /** Adds to the line for this product in this color/size (a new line for another choice). */
  add: (id: string, quantity?: number, selection?: Selection) => void;
  /** Sets one line's quantity; 0 removes it. A bare id means the product's plain line. */
  setQuantity: (line: CartLine | string, q: number) => void;
  clear: () => void;
}
const CartContext = createContext<CartContextValue | undefined>(undefined);
export function CartProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation("cart");
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  const storage = useRef<CartStorage | null>(null);
  // Stored items are validated against live stock, so restore only once the catalog has loaded.
  const { data: catalog } = useQuery(catalogQuery);
  const products = catalog?.products;

  // Restore after hydration (the server never sees the visitor's cart).
  useEffect(() => {
    if (!products || ready) return;
    storage.current = defaultCartStorage();
    setItems(normalizeCart(storage.current.load(), products));
    setReady(true);
  }, [products, ready]);

  // The cart is shared with other tabs and store subdomains: re-read it when
  // this tab comes back, so a stale copy never overwrites newer changes.
  useEffect(() => {
    if (!ready || !products) return;
    const reload = () => {
      if (document.visibilityState !== "visible" || !storage.current) return;
      setItems(normalizeCart(storage.current.load(), products));
    };
    document.addEventListener("visibilitychange", reload);
    window.addEventListener("focus", reload);
    return () => {
      document.removeEventListener("visibilitychange", reload);
      window.removeEventListener("focus", reload);
    };
  }, [ready, products]);

  useEffect(() => {
    if (ready) storage.current?.save(items);
  }, [items, ready]);

  const setQuantity = (line: CartLine | string, q: number) =>
    setItems((prev) => updateCart(prev, line, q, products ?? []));
  const add = (id: string, q = 1, selection: Selection = {}) => {
    const line: CartLine = {
      productId: id,
      color: selection.color ?? null,
      size: selection.size ?? null,
    };
    setItems((prev) =>
      updateCart(
        prev,
        line,
        (prev.find((i) => lineKey(i) === lineKey(line))?.quantity ?? 0) + q,
        products ?? [],
      ),
    );
    toast.success(t("added"));
  };
  return (
    <CartContext.Provider value={{ items, ready, add, setQuantity, clear: () => setItems([]) }}>
      {children}
    </CartContext.Provider>
  );
}
export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("CartProvider is required");
  return context;
}
