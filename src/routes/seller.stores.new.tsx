import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useSeller } from "@/components/seller/seller-context";
import { SellerPageHeader } from "@/components/seller/seller-shell";
import { CreateStoreForm, CreateStoreGate, StoreLimitLine } from "@/components/seller/create-store";
import { useCreateStore, useStoreLimit } from "@/components/seller/use-create-store";
import { canCreateStore } from "@/services/store-limits";

export const Route = createFileRoute("/seller/stores/new")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Create another store — Saloree" }, { name: "robots", content: "noindex" }],
  }),
  component: CreateAnotherStorePage,
});

/** A second (third…) store: the same form and checks as the first one. */
function CreateAnotherStorePage() {
  const { user, stores, categories, storesKey, setStoreId } = useSeller();
  const navigate = useNavigate();
  const limit = useStoreLimit(user.id);
  const create = useCreateStore({
    userId: user.id,
    storesKey,
    // The new store becomes the active one; its home shows the next steps.
    onCreated: async (store) => {
      setStoreId(store.id);
      await navigate({ to: "/seller" });
    },
  });
  const full = limit.isSuccess && !canCreateStore(limit.data);
  const names = categories.map((c) => c.name);
  return (
    <div className="seller-page">
      <SellerPageHeader
        title="Create another store"
        description="It starts as a draft. Each store is reviewed by Saloree before it goes live."
      />
      <StoreLimitLine userId={user.id} />
      {full ? (
        <div className="seller-empty mt-4" role="note" data-testid="store-limit-reached">
          <h3>
            You have reached your store limit ({limit.data.used} of {limit.data.max_stores})
          </h3>
          <p>Contact Saloree support to open more.</p>
        </div>
      ) : (
        <section className="seller-card mt-4" aria-label="New store">
          <CreateStoreGate userId={user.id} categoryNames={names}>
            <CreateStoreForm
              stores={stores}
              categoryNames={names}
              busy={create.isPending}
              error={create.error}
              onSubmit={(values, files) => create.mutateAsync([values, files])}
            />
          </CreateStoreGate>
        </section>
      )}
    </div>
  );
}
