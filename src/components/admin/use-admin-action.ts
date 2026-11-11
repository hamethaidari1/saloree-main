import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { friendlyError } from "@/services/errors";
import { adminKeys } from "./keys";

type Overrides = Parameters<typeof friendlyError>[1];

/**
 * Wraps an admin write: success/error toasts, then refreshes every admin
 * list plus the public catalog (store/product/category changes show there).
 */
export function useAdminAction<V>(
  fn: (vars: V) => Promise<unknown>,
  options: { success: (vars: V) => string; errors?: Overrides },
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (_d, vars) => toast.success(options.success(vars)),
    onError: (e) => toast.error(friendlyError(e, options.errors)),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: adminKeys.all }),
        queryClient.invalidateQueries({ queryKey: ["catalog"] }),
      ]),
  });
}

/** Case-insensitive match over a few text fields. */
export const matches = (query: string, ...fields: (string | null | undefined)[]) => {
  const q = query.trim().toLowerCase();
  return !q || fields.some((f) => f?.toLowerCase().includes(q));
};
