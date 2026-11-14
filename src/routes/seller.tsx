import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { SELECTED_STORE_KEY, SellerProvider } from "@/components/seller/seller-context";
import { SellerShell } from "@/components/seller/seller-shell";
import { StoreForm } from "@/components/seller/store-form";
import { requireAuth } from "@/lib/auth";
import { legalDocument } from "@/services/legal";
import { friendlyError, sellerService, storeError } from "@/services/seller";

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
  const queryClient = useQueryClient();
  const storesKey = useMemo(() => ["seller", "stores", user.id] as const, [user.id]);
  const stores = useQuery({ queryKey: storesKey, queryFn: sellerService.getMyStores });
  const categories = useQuery({
    queryKey: ["categories"],
    queryFn: sellerService.getCategories,
    staleTime: 5 * 60_000,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    try {
      setSelectedId(localStorage.getItem(SELECTED_STORE_KEY));
    } catch {
      /* storage unavailable */
    }
  }, []);
  const selectStore = (id: string) => {
    setSelectedId(id);
    try {
      localStorage.setItem(SELECTED_STORE_KEY, id);
    } catch {
      /* storage unavailable */
    }
  };

  const agreement = legalDocument("seller-agreement");
  const createStore = useMutation({
    mutationFn: (args: Parameters<typeof sellerService.createStore>) =>
      sellerService.createStore(...args),
    onSuccess: async (store) => {
      toast.success(`${store.name} was created as a draft`);
      if (agreement)
        await sellerService
          .recordSellerAgreement(store.id, agreement.updated)
          .catch((e: { message?: string; code?: string }) =>
            toast.warning(
              `Your acceptance of the Seller Agreement could not be saved: ${e.message ?? String(e)}${e.code ? ` (${e.code})` : ""}`,
            ),
          );
      selectStore(store.id);
      await queryClient.invalidateQueries({ queryKey: storesKey });
    },
    onError: (e) => toast.error(storeError(e)),
  });

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

  const store = stores.data.find((s) => s.id === selectedId) ?? stores.data[0];
  if (!store)
    return (
      <main className="market-container py-10">
        <section className="seller-card" aria-labelledby="create-store-heading">
          <h1 id="create-store-heading" className="text-xl font-semibold">
            Create your store
          </h1>
          <p className="page-subtitle mb-6">
            Your store starts as a draft, so you can add products before shoppers see it.
          </p>
          <StoreForm
            categoryNames={categories.data.map((c) => c.name)}
            submitLabel="Create store"
            agreement={agreement}
            busy={createStore.isPending}
            onSubmit={(values, files) => createStore.mutateAsync([values, files])}
          />
        </section>
      </main>
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
        <Outlet />
      </SellerShell>
    </SellerProvider>
  );
}
