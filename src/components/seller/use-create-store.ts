import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { StoreRow } from "@/data/db";
import { legalDocument } from "@/services/legal";
import { sellerService, storeError } from "@/services/seller";
import { sellerDashboardService } from "@/services/seller-dashboard";
import { storeLimitKeys, storeLimitService } from "@/services/store-limits";

/** The signed-in seller's store limit ({ max_stores, used }). */
export function useStoreLimit(userId: string) {
  return useQuery({
    queryKey: storeLimitKeys.mine(userId),
    queryFn: storeLimitService.mine,
    retry: false,
  });
}

/**
 * Creates a store (status draft). The Seller Agreement version is recorded on
 * every store; when the person already accepted this version on another store
 * it is not asked again, and the same version is recorded for the new one.
 * A refused limit shows the database's own words.
 */
export function useCreateStore({
  userId,
  storesKey,
  onCreated,
}: {
  userId: string;
  storesKey: readonly unknown[];
  onCreated: (store: StoreRow) => void | Promise<void>;
}) {
  const queryClient = useQueryClient();
  const agreement = legalDocument("seller-agreement");
  return useMutation({
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: storesKey }),
        queryClient.invalidateQueries({ queryKey: storeLimitKeys.mine(userId) }),
      ]);
      await onCreated(store);
    },
    // e.g. "Store limit reached: you can have 1 store(s). Contact Saloree support to open more."
    onError: (e) => toast.error(storeError(e)),
  });
}

/** Pending orders per store; only fetched when the seller has more than one store. */
export function usePendingByStore(stores: StoreRow[]) {
  const ids = stores.map((s) => s.id).sort();
  return useQuery({
    queryKey: ["seller", "pending-by-store", ...ids],
    queryFn: () => sellerDashboardService.pendingByStore(ids),
    enabled: ids.length > 1,
    refetchInterval: 60_000,
    retry: false,
  });
}
