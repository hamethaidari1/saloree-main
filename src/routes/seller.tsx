import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { SellerProvider } from "@/components/seller/seller-context";
import { SellerShell } from "@/components/seller/seller-shell";
import { CreateStoreForm } from "@/components/seller/create-store";
import { useCreateStore } from "@/components/seller/use-create-store";
import { GettingStarted } from "@/components/seller/verification/onboarding";
import { requireAuth } from "@/lib/auth";
import { readActiveStoreId, resolveActiveStore, writeActiveStoreId } from "@/lib/active-store";
import { friendlyError, sellerService } from "@/services/seller";

/** Layout for every /seller/* page: loads the seller's stores, then the sidebar shell. */
export const Route = createFileRoute("/seller")({
  ssr: false,
  beforeLoad: requireAuth("seller"),
  head: () => ({
    meta: [{ title: "Seller — Saloree" }, { name: "robots", content: "noindex" }],
  }),
  pendingComponent: CatalogSkeleton,
  component: SellerLayout,
});

function SellerLayout() {
  const { user } = Route.useRouteContext();
  const storesKey = useMemo(() => ["seller", "stores", user.id] as const, [user.id]);
  const stores = useQuery({ queryKey: storesKey, queryFn: sellerService.getMyStores });
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: sellerService.getCategories,
    staleTime: 5 * 60_000,
  });
  // The active store: remembered id, but only if it is one of MY stores (checked below).
  const [selectedId, setSelectedId] = useState<string | null>(() => readActiveStoreId());
  const selectStore = useCallback((id: string) => {
    setSelectedId(id);
    writeActiveStoreId(id);
  }, []);
  const createStore = useCreateStore({
    userId: user.id,
    storesKey,
    onCreated: (store) => selectStore(store.id),
  });
  const active = stores.data ? resolveActiveStore(stores.data, selectedId) : null;
  // A remembered id that isn't mine (or is gone) is replaced by the store actually shown.
  const activeId = active?.id ?? null;
  useEffect(() => {
    if (activeId && activeId !== selectedId) selectStore(activeId);
  }, [activeId, selectedId, selectStore]);

  if (stores.isPending || categories.isPending) return <CatalogSkeleton />;
  if (stores.isError || categories.isError)
    return (
      <main className="market-container py-10">
        <div role="alert" className="seller-empty">
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
      </main>
    );

  const store = active;
  if (!store)
    return (
      <GettingStarted userId={user.id} categoryNames={categories.data.map((c) => c.name)}>
        <section className="seller-card" aria-labelledby="create-store-heading">
          <h2 id="create-store-heading" className="text-xl font-semibold">
            Create your store
          </h2>
          <p className="page-subtitle mb-6">
            Your store starts as a draft, so you can add products before shoppers see it. It can be
            published once your verification is approved.
          </p>
          <CreateStoreForm
            stores={stores.data}
            categoryNames={categories.data.map((c) => c.name)}
            busy={createStore.isPending}
            error={createStore.error}
            onSubmit={(values, files) => createStore.mutateAsync([values, files])}
          />
        </section>
      </GettingStarted>
    );

  return (
    <SellerProvider
      value={{
        user,
        store,
        stores: stores.data,
        setStoreId: selectStore,
        categories: categories.data,
        storesKey,
      }}
    >
      <SellerShell>
        {/* Keyed by the active store: switching remounts the page (same page type), so no
            state of the other store survives; every query key also carries the store id. */}
        <Fragment key={store.id}>
          <Outlet />
        </Fragment>
      </SellerShell>
    </SellerProvider>
  );
}
