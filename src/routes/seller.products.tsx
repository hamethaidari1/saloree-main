import { createFileRoute } from "@tanstack/react-router";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { ProductsPanel } from "@/components/seller/products-panel";
import { useSeller } from "@/components/seller/seller-context";

export const Route = createFileRoute("/seller/products")({
  ssr: false,
  pendingComponent: CatalogSkeleton,
  component: SellerProductsPage,
});

function SellerProductsPage() {
  const { store, categories } = useSeller();
  return (
    <div className="seller-page">
      <ProductsPanel store={store} categories={categories} />
    </div>
  );
}
