import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { useSeller } from "@/components/seller/seller-context";
import { SellerPageHeader } from "@/components/seller/seller-shell";
import { StoreForm } from "@/components/seller/store-form";
import { sellerService, storeError } from "@/services/seller";
import { StoreAddressLink } from "@/components/marketplace/store-link";

export const Route = createFileRoute("/seller/content")({
  ssr: false,
  pendingComponent: CatalogSkeleton,
  component: ContentPage,
});

/** Store page content: name, description, category, location, logo, banner. */
function ContentPage() {
  const { store, categories, storesKey } = useSeller();
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: (args: Parameters<typeof sellerService.updateStore>) =>
      sellerService.updateStore(...args),
    onSuccess: async () => {
      toast.success("Store page saved");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: storesKey }),
        queryClient.invalidateQueries({ queryKey: ["catalog"] }),
      ]);
    },
    onError: (e) => toast.error(storeError(e)),
  });
  return (
    <div className="seller-page">
      <SellerPageHeader
        title="Content"
        description="What shoppers see on your store page."
        actions={store.status === "published" ? <StoreAddressLink slug={store.slug} /> : undefined}
      />
      <section className="seller-card max-w-3xl">
        <StoreForm
          key={`${store.id}-${store.updated_at}`}
          store={store}
          categoryNames={categories.map((c) => c.name)}
          submitLabel="Save store page"
          busy={update.isPending}
          onSubmit={(values, files) => update.mutateAsync([store, values, files])}
        />
      </section>
    </div>
  );
}
