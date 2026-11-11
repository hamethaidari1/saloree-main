import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { CART_KEY, normalizeCart, updateCart, type CartItem } from "@/services/cart";
import { catalogQuery } from "@/services/catalog";
interface CartContextValue {
  items: CartItem[];
  ready: boolean;
  add: (id: string, quantity?: number) => void;
  setQuantity: (id: string, q: number) => void;
  clear: () => void;
}
const CartContext = createContext<CartContextValue | undefined>(undefined);
export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);
  // Stored items are validated against live stock, so restore only once the catalog has loaded.
  const { data: catalog } = useQuery(catalogQuery);
  const products = catalog?.products;
  useEffect(() => {
    if (!products || ready) return;
    try {
      setItems(normalizeCart(JSON.parse(localStorage.getItem(CART_KEY) ?? "[]"), products));
    } catch {
      setItems([]);
    }
    setReady(true);
  }, [products, ready]);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem(CART_KEY, JSON.stringify(items));
      } catch {
        /* Shopping remains available without browser storage. */
      }
  }, [items, ready]);
  const setQuantity = (id: string, q: number) =>
    setItems((prev) => updateCart(prev, id, q, products ?? []));
  const add = (id: string, q = 1) => {
    setItems((prev) =>
      updateCart(
        prev,
        id,
        (prev.find((i) => i.productId === id)?.quantity ?? 0) + q,
        products ?? [],
      ),
    );
    toast.success("Added to your cart");
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
