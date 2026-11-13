import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { SELECTED_STORE_KEY } from "@/components/seller/seller-context";
import { requireAuth } from "@/lib/auth";
import { sellerService } from "@/services/seller";
import { storeThemeQuery, themeError } from "@/services/themes";
import { templateDataFromSeller } from "@/templates/data";
import { resolveTheme } from "@/templates/registry";
import { TemplateView } from "@/templates/render";

/**
 * Owner-only preview of the seller's own store in its SAVED theme — works
 * for draft stores, which shoppers can't see yet. Same TemplateView as live.
 */
export const Route = createFileRoute("/preview/store")({
  ssr: false,
  beforeLoad: requireAuth("seller"),
  head: () => ({
    meta: [{ title: "Store preview — Saloree" }, { name: "robots", content: "noindex" }],
  }),
  pendingComponent: CatalogSkeleton,
  component: OwnerPreview,
});

function selectedStoreId() {
  try {
    return localStorage.getItem(SELECTED_STORE_KEY);
  } catch {
    return null;
  }
}

function OwnerPreview() {
  const { user } = Route.useRouteContext();
  const stores = useQuery({
    queryKey: ["seller", "stores", user.id],
    queryFn: sellerService.getMyStores,
  });
  const store = stores.data?.find((s) => s.id === selectedStoreId()) ?? stores.data?.[0];
  const categories = useQuery({ queryKey: ["categories"], queryFn: sellerService.getCategories });
  const products = useQuery({
    queryKey: ["seller", "products", store?.id],
    queryFn: () => sellerService.getStoreProducts(store!.id),
    enabled: !!store,
  });
  const theme = useQuery({ ...storeThemeQuery(store?.id ?? ""), enabled: !!store, retry: false });

  if (
    stores.isPending ||
    categories.isPending ||
    (store && (products.isPending || theme.isPending))
  )
    return <CatalogSkeleton />;
  if (!store)
    return (
      <main className="market-container py-16 text-center">
        <p>You don't have a store yet.</p>
        <Button asChild className="mt-4">
          <Link to="/seller">Create your store</Link>
        </Button>
      </main>
    );
  const error = stores.error ?? categories.error ?? products.error;
  if (error || !products.data || !categories.data)
    return (
      <main role="alert" className="market-container py-16 text-center">
        {themeError(error)}
      </main>
    );
  const { template, settings } = resolveTheme(theme.data ?? null);
  return (
    <>
      <div className="owner-preview-bar" role="status">
        <Eye size={16} aria-hidden />
        <span>
          Preview of <strong>{store.name}</strong>
          {store.status !== "published" && " — only you can see this until the store is published"}.
          Links and buttons are turned off.
        </span>
        {theme.error && <span className="seller-error">{themeError(theme.error)}</span>}
        <Link to="/seller/customize" className="owner-preview-link">
          Customize
        </Link>
      </div>
      <main>
        <TemplateView
          template={template}
          settings={settings}
          data={templateDataFromSeller(store, products.data, categories.data)}
          mode="preview"
        />
      </main>
    </>
  );
}
