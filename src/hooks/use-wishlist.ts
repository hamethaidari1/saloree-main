/**
 * Wishlist state shared by every heart on the page: one cached query of the
 * signed-in user's saved product ids. A toggle updates that cache at once
 * (optimistic), rolls it back if the database refuses, and refreshes the
 * wishlist queries afterwards.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { catalogQuery } from "@/services/catalog";
import { wishlistService } from "@/services/wishlist";

export const wishlistKeys = {
  all: ["wishlist"] as const,
  ids: (userId: string | undefined) => ["wishlist", userId ?? "guest", "ids"] as const,
  items: (userId: string | undefined) => ["wishlist", userId ?? "guest", "items"] as const,
};

/** Saved product ids for the signed-in user (empty for guests). */
export function useWishlistIds() {
  const { user, ready } = useAuth();
  const query = useQuery({
    queryKey: wishlistKeys.ids(user?.id),
    queryFn: wishlistService.ids,
    enabled: ready && !!user,
    staleTime: 60_000,
  });
  return { ...query, ids: query.data ?? [], signedIn: !!user, ready };
}

/**
 * How many saved products can be shown (the catalog only holds active
 * products of published stores, so hidden ones are not counted).
 */
export function useWishlistCount(): number {
  const { ids } = useWishlistIds();
  const { data: catalog } = useQuery(catalogQuery);
  if (!catalog) return 0;
  const available = new Set(catalog.products.map((p) => p.id));
  return ids.filter((id) => available.has(id)).length;
}

type ToggleVars = { productId: string; save: boolean };

/** Save / remove with an optimistic update. `onError` gets the real error. */
export function useWishlistToggle(
  options: { onError?: (error: unknown, vars: ToggleVars) => void } = {},
) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const key = wishlistKeys.ids(user?.id);

  const mutation = useMutation({
    mutationFn: ({ productId, save }: ToggleVars) =>
      save ? wishlistService.add(productId) : wishlistService.remove(productId),
    onMutate: async ({ productId, save }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<string[]>(key);
      queryClient.setQueryData<string[]>(key, (ids = []) =>
        save ? [...new Set([...ids, productId])] : ids.filter((id) => id !== productId),
      );
      return { previous };
    },
    onError: (error, vars, context) => {
      queryClient.setQueryData(key, context?.previous);
      options.onError?.(error, vars);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: wishlistKeys.all }),
  });
  return mutation;
}
