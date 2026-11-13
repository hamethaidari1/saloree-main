import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { PanelState } from "@/components/seller/panel-state";
import { useSeller } from "@/components/seller/seller-context";
import { SellerPageHeader } from "@/components/seller/seller-shell";
import { friendlyError } from "@/services/errors";
import { sellerService, type SellerProduct } from "@/services/seller";
import {
  LOW_STOCK_THRESHOLD,
  sellerDashboardService,
  stockSchema,
} from "@/services/seller-dashboard";

export const Route = createFileRoute("/seller/inventory")({
  ssr: false,
  pendingComponent: CatalogSkeleton,
  component: InventoryPage,
});

/** One product row: its own input, save button and saved/error state. */
function StockRow({ product, productsKey }: { product: SellerProduct; productsKey: unknown[] }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(String(product.stock));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: (stock: number) => sellerDashboardService.updateStock(product.id, stock),
    onSuccess: async (stock) => {
      setValue(String(stock));
      setSaved(true);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: productsKey }),
        queryClient.invalidateQueries({ queryKey: ["seller", "low-stock"] }),
        queryClient.invalidateQueries({ queryKey: ["catalog"] }), // storefront stock
      ]);
    },
    onError: (e) => setError(friendlyError(e)),
  });
  const parsed = stockSchema.safeParse(value);
  const dirty = !(parsed.success && parsed.data === product.stock);
  const inputId = `stock-${product.id}`;

  const submit = () => {
    setSaved(false);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Invalid stock.");
    setError(null);
    save.mutate(parsed.data);
  };

  return (
    <tr>
      <td>
        <span className="flex items-center gap-3">
          <span className="seller-thumb size-10">
            {product.featured_image ? (
              <img src={product.featured_image} alt="" loading="lazy" />
            ) : (
              <ImageOff size={14} aria-hidden />
            )}
          </span>
          <label htmlFor={inputId} className="min-w-0">
            <span className="block truncate font-medium">{product.title}</span>
            <Badge variant={product.status === "active" ? "default" : "secondary"}>
              {product.status}
            </Badge>
          </label>
        </span>
      </td>
      <td>
        <form
          className="inventory-cell"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Input
            id={inputId}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            className="w-24"
            value={value}
            aria-invalid={!!error}
            aria-describedby={`${inputId}-status`}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
              setError(null);
            }}
          />
          <Button type="submit" size="sm" disabled={!dirty || save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <span id={`${inputId}-status`} role="status" className="inventory-status">
            {error ? (
              <span className="seller-error">{error}</span>
            ) : saved && !dirty ? (
              <span className="flex items-center gap-1 text-primary">
                <Check size={14} aria-hidden /> Saved
              </span>
            ) : product.status === "active" && product.stock <= LOW_STOCK_THRESHOLD ? (
              <span className="text-destructive">{product.stock < 1 ? "Out of stock" : "Low"}</span>
            ) : null}
          </span>
        </form>
      </td>
    </tr>
  );
}

function InventoryPage() {
  const { store } = useSeller();
  const productsKey = ["seller", "products", store.id];
  const products = useQuery({
    queryKey: productsKey,
    queryFn: () => sellerService.getStoreProducts(store.id),
  });
  return (
    <div className="seller-page">
      <SellerPageHeader
        title="Inventory"
        description="Set how many of each product you have. Shoppers can't order more than this."
      />
      <PanelState
        query={products}
        errorText="Your products could not be loaded."
        empty={{
          title: "No products yet",
          description: "Add products first, then manage stock here.",
        }}
      >
        {(list) => (
          <div className="seller-card overflow-x-auto p-0">
            <table className="seller-table">
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Available</th>
                </tr>
              </thead>
              <tbody>
                {/* Stable order (by title) so rows don't jump after a save. */}
                {[...list]
                  .sort((a, b) => a.title.localeCompare(b.title))
                  .map((p) => (
                    <StockRow key={p.id} product={p} productsKey={productsKey} />
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelState>
    </div>
  );
}
