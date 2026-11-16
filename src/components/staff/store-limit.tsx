import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog, type ConfirmRequest } from "@/components/marketplace/confirm-dialog";
import {
  limitErrorText,
  limitInputSchema,
  MAX_STORE_LIMIT,
  MIN_STORE_LIMIT,
  storeLimitKeys,
  storeLimitService,
} from "@/services/store-limits";

/**
 * "Store limit: 1 (uses 1)" for one seller (staff can read it), and for
 * admins a control to change it (1 to 20, confirmed; the database decides).
 */
export function StoreLimitControl({ userId, canEdit }: { userId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const limit = useQuery({
    queryKey: storeLimitKeys.seller(userId),
    queryFn: () => storeLimitService.forSeller(userId),
    retry: false,
  });
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const save = useMutation({
    mutationFn: (max: number) => storeLimitService.setForSeller(userId, max),
    onSuccess: async (_d, max) => {
      toast.success(`Store limit set to ${max}`);
      setValue("");
      await qc.invalidateQueries({ queryKey: storeLimitKeys.seller(userId) });
    },
    onError: (e) => setProblem(limitErrorText(e)),
  });

  if (limit.isPending) return <p className="seller-hint">Loading the store limit…</p>;
  if (limit.isError)
    return (
      <p role="alert" className="seller-error">
        Store limit could not be loaded: {limitErrorText(limit.error)}
      </p>
    );
  const id = `store-limit-${userId}`;
  return (
    <div className="store-limit" data-testid="store-limit">
      <p>
        <strong>Store limit:</strong> {limit.data.max_stores} (uses {limit.data.used})
      </p>
      {canEdit && (
        <form
          className="store-limit-form"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            setProblem(null);
            const r = limitInputSchema.safeParse(value);
            if (!r.success) return setProblem(r.error.issues[0]?.message ?? "Check the number.");
            setConfirm({
              title: `Set the store limit to ${r.data}?`,
              description:
                r.data < limit.data.used
                  ? `This seller already has ${limit.data.used} stores. A lower limit only stops new ones; existing stores stay.`
                  : `The seller can then have up to ${r.data} store${r.data === 1 ? "" : "s"}.`,
              confirmLabel: "Set limit",
              run: () => save.mutateAsync(r.data),
            });
          }}
        >
          <label htmlFor={id} className="verify-label">
            New limit
          </label>
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            min={MIN_STORE_LIMIT}
            max={MAX_STORE_LIMIT}
            step={1}
            value={value}
            placeholder={String(limit.data.max_stores)}
            aria-invalid={!!problem}
            aria-describedby={problem ? `${id}-error` : `${id}-hint`}
            onChange={(e) => setValue(e.target.value)}
          />
          <Button type="submit" size="sm" variant="outline" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Change"}
          </Button>
          <p id={`${id}-hint`} className="seller-hint">
            From {MIN_STORE_LIMIT} to {MAX_STORE_LIMIT}. The default is 1.
          </p>
          {problem && (
            <p id={`${id}-error`} role="alert" className="seller-error">
              {problem}
            </p>
          )}
        </form>
      )}
      <ConfirmDialog request={confirm} busy={save.isPending} onClose={() => setConfirm(null)} />
    </div>
  );
}
