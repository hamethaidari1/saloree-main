import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { SignOutButton } from "@/components/marketplace/auth-form";
import { OrdersPanel } from "@/components/seller/orders-panel";
import { ProductsPanel } from "@/components/seller/products-panel";
import { StoreForm } from "@/components/seller/store-form";
import type { StoreRow } from "@/data/db";
import { requireAuth } from "@/lib/auth";
import { friendlyError, sellerService } from "@/services/seller";

const TABS = ["products", "orders", "settings"] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute("/seller")({
  ssr: false,
  beforeLoad: requireAuth("seller"),
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } =>
    TABS.includes(s["tab"] as Tab) ? { tab: s["tab"] as Tab } : {},
  head: () => ({
    meta: [{ title: "Seller dashboard — Saloree" }, { name: "robots", content: "noindex" }],
  }),
  pendingComponent: CatalogSkeleton,
  component: SellerPage,
});

function SellerPage() {
  const { user } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const storesKey = ["seller", "stores", user.id];
  const stores = useQuery({ queryKey: storesKey, queryFn: sellerService.getMyStores });
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: sellerService.getCategories,
    staleTime: 5 * 60_000,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const createStore = useMutation({
    mutationFn: (args: Parameters<typeof sellerService.createStore>) =>
      sellerService.createStore(...args),
    onSuccess: async (store) => {
      toast.success(`${store.name} was created as a draft`);
      setSelectedId(store.id);
      await queryClient.invalidateQueries({ queryKey: storesKey });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const list = stores.data ?? [];
  const store = list.find((s) => s.id === selectedId) ?? list[0];

  return (
    <main className="market-container pb-16">
      <div className="account-header">
        <div>
          <h1 className="page-title">Seller dashboard</h1>
          <p className="page-subtitle">{user.email}</p>
        </div>
        <SignOutButton />
      </div>

      {stores.isPending || categories.isPending ? (
        <CatalogSkeleton />
      ) : stores.isError || categories.isError ? (
        <div role="alert" className="seller-empty mt-10">
          <h3>Your dashboard could not be loaded.</h3>
          <p>{friendlyError(stores.error ?? categories.error)}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void stores.refetch();
              void categories.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      ) : !store ? (
        <section className="seller-card mt-10" aria-labelledby="create-store-heading">
          <h2 id="create-store-heading" className="text-xl font-semibold">
            Create your store
          </h2>
          <p className="page-subtitle mb-6">
            Your store starts as a draft, so you can add products before shoppers see it.
          </p>
          <StoreForm
            categoryNames={categories.data.map((c) => c.name)}
            submitLabel="Create store"
            busy={createStore.isPending}
            onSubmit={(values, files) => createStore.mutateAsync([values, files])}
          />
        </section>
      ) : (
        <StoreDashboard
          store={store}
          stores={list}
          onSelect={setSelectedId}
          categories={categories.data}
          storesKey={storesKey}
        />
      )}
    </main>
  );
}

function StoreDashboard({
  store,
  stores,
  onSelect,
  categories,
  storesKey,
}: {
  store: StoreRow;
  stores: StoreRow[];
  onSelect: (id: string) => void;
  categories: Awaited<ReturnType<typeof sellerService.getCategories>>;
  storesKey: string[];
}) {
  const { tab = "products" } = Route.useSearch();
  const navigate = useNavigate({ from: "/seller" });
  const queryClient = useQueryClient();
  const updateStore = useMutation({
    mutationFn: (args: Parameters<typeof sellerService.updateStore>) =>
      sellerService.updateStore(...args),
    onSuccess: async () => {
      toast.success("Store settings saved");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: storesKey }),
        queryClient.invalidateQueries({ queryKey: ["catalog"] }),
      ]);
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const published = store.status === "published";

  return (
    <>
      <section className="seller-store-head">
        <div className="seller-store-logo">
          {store.logo_url ? <img src={store.logo_url} alt="" /> : store.name.slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-semibold">{store.name}</h2>
            <Badge variant={published ? "default" : "secondary"}>{store.status}</Badge>
          </div>
          <p className="seller-hint">
            {published
              ? `Live at /store/${store.slug}`
              : "Draft — not visible to shoppers until it is published."}
          </p>
        </div>
        {stores.length > 1 && (
          <label className="seller-field">
            <span className="sr-only">Choose store</span>
            <select
              className="seller-select"
              value={store.id}
              onChange={(e) => onSelect(e.target.value)}
            >
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {published && (
          <Button asChild variant="outline" size="sm">
            <Link to="/store/$slug" params={{ slug: store.slug }}>
              View store
              <ExternalLink />
            </Link>
          </Button>
        )}
      </section>

      <Tabs
        value={tab}
        onValueChange={(value) => navigate({ search: { tab: value as Tab }, replace: true })}
        className="mt-6"
      >
        <TabsList>
          <TabsTrigger value="products">Products</TabsTrigger>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="settings">Store settings</TabsTrigger>
        </TabsList>
        <TabsContent value="products" className="mt-6">
          <ProductsPanel store={store} categories={categories} />
        </TabsContent>
        <TabsContent value="orders" className="mt-6">
          <OrdersPanel stores={[store]} />
        </TabsContent>
        <TabsContent value="settings" className="mt-6">
          <section className="seller-card" aria-labelledby="settings-heading">
            <h2 id="settings-heading" className="text-lg font-semibold mb-6">
              Store settings
            </h2>
            <StoreForm
              key={`${store.id}-${store.updated_at}`}
              store={store}
              categoryNames={categories.map((c) => c.name)}
              submitLabel="Save settings"
              busy={updateStore.isPending}
              onSubmit={(values, files) => updateStore.mutateAsync([store, values, files])}
            />
          </section>
        </TabsContent>
      </Tabs>
    </>
  );
}
