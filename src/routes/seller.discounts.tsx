import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog, type ConfirmRequest } from "@/components/marketplace/confirm-dialog";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { PanelState } from "@/components/seller/panel-state";
import { useSeller } from "@/components/seller/seller-context";
import { SellerPageHeader } from "@/components/seller/seller-shell";
import { money } from "@/services/catalog";
import {
  discountError,
  discountInputSchema,
  discountState,
  discountsService,
  type Discount,
  type DiscountInput,
} from "@/services/discounts";

export const Route = createFileRoute("/seller/discounts")({
  ssr: false,
  pendingComponent: CatalogSkeleton,
  component: DiscountsPage,
});

/** ISO → value for <input type="datetime-local"> in the seller's own time zone. */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type FormState = {
  code: string;
  type: "percent" | "fixed";
  value: string;
  min_subtotal: string;
  max_uses: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
};
type FieldErrors = Partial<Record<keyof FormState, string>>;

const describeValue = (d: Pick<Discount, "type" | "value">) =>
  d.type === "percent" ? `${d.value}% off` : `${money(d.value)} off`;

function DiscountForm({
  discount,
  busy,
  onSubmit,
  onCancel,
}: {
  discount: Discount | null;
  busy: boolean;
  onSubmit: (input: DiscountInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [v, setV] = useState<FormState>({
    code: discount?.code ?? "",
    type: discount?.type ?? "percent",
    value: discount ? String(discount.value) : "",
    min_subtotal: discount?.min_subtotal != null ? String(discount.min_subtotal) : "",
    max_uses: discount?.max_uses != null ? String(discount.max_uses) : "",
    starts_at: toLocalInput(discount?.starts_at ?? null),
    ends_at: toLocalInput(discount?.ends_at ?? null),
    is_active: discount?.is_active ?? true,
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = <K extends keyof FormState>(k: K, value: FormState[K]) =>
    setV((s) => ({ ...s, [k]: value }));
  const err = (k: keyof FormState) =>
    errors[k] && (
      <p id={`d-${k}-error`} className="seller-error">
        {errors[k]}
      </p>
    );
  const a11y = (k: keyof FormState) => ({
    id: `d-${k}`,
    "aria-invalid": !!errors[k],
    "aria-describedby": errors[k] ? `d-${k}-error` : undefined,
  });

  return (
    <form
      className="seller-form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = discountInputSchema.safeParse(v);
        if (!parsed.success) {
          const fe = parsed.error.flatten().fieldErrors;
          return setErrors(Object.fromEntries(Object.entries(fe).map(([k, m]) => [k, m?.[0]])));
        }
        setErrors({});
        await onSubmit(v).catch(() => {});
      }}
    >
      <div className="seller-form-row">
        <div className="seller-field">
          <Label htmlFor="d-code">Code</Label>
          <Input
            {...a11y("code")}
            value={v.code}
            maxLength={32}
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="SUMMER10"
            onChange={(e) => set("code", e.target.value.toUpperCase().replace(/\s/g, ""))}
          />
          {err("code") ?? <p className="seller-hint">Shoppers type this at checkout.</p>}
        </div>
        <div className="seller-field">
          <Label htmlFor="d-type">Type</Label>
          <select
            {...a11y("type")}
            className="seller-select"
            value={v.type}
            onChange={(e) => set("type", e.target.value as FormState["type"])}
          >
            <option value="percent">Percentage off</option>
            <option value="fixed">Fixed amount off (USD)</option>
          </select>
        </div>
      </div>
      <div className="seller-form-row three">
        <div className="seller-field">
          <Label htmlFor="d-value">
            {v.type === "percent" ? "Percent (1–100)" : "Amount (USD)"}
          </Label>
          <Input
            {...a11y("value")}
            type="number"
            inputMode="decimal"
            min={v.type === "percent" ? 1 : 0.01}
            max={v.type === "percent" ? 100 : undefined}
            step={v.type === "percent" ? 1 : 0.01}
            value={v.value}
            onChange={(e) => set("value", e.target.value)}
          />
          {err("value")}
        </div>
        <div className="seller-field">
          <Label htmlFor="d-min_subtotal">Minimum order (USD)</Label>
          <Input
            {...a11y("min_subtotal")}
            type="number"
            inputMode="decimal"
            min={0}
            step={0.01}
            placeholder="None"
            value={v.min_subtotal}
            onChange={(e) => set("min_subtotal", e.target.value)}
          />
          {err("min_subtotal")}
        </div>
        <div className="seller-field">
          <Label htmlFor="d-max_uses">Usage limit</Label>
          <Input
            {...a11y("max_uses")}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            placeholder="Unlimited"
            value={v.max_uses}
            onChange={(e) => set("max_uses", e.target.value)}
          />
          {err("max_uses")}
        </div>
      </div>
      <div className="seller-form-row">
        <div className="seller-field">
          <Label htmlFor="d-starts_at">Starts (optional)</Label>
          <Input
            {...a11y("starts_at")}
            type="datetime-local"
            value={v.starts_at}
            onChange={(e) => set("starts_at", e.target.value)}
          />
          {err("starts_at")}
        </div>
        <div className="seller-field">
          <Label htmlFor="d-ends_at">Ends (optional)</Label>
          <Input
            {...a11y("ends_at")}
            type="datetime-local"
            value={v.ends_at}
            onChange={(e) => set("ends_at", e.target.value)}
          />
          {err("ends_at")}
        </div>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <Switch checked={v.is_active} onCheckedChange={(c) => set("is_active", c)} />
        Active — shoppers can use this code
      </label>
      {discount && (
        <p className="seller-hint">
          Used {discount.used_count} time{discount.used_count === 1 ? "" : "s"} so far.
        </p>
      )}
      <div className="seller-form-actions">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : discount ? "Save discount" : "Create discount"}
        </Button>
      </div>
    </form>
  );
}

function DiscountsPage() {
  const { store } = useSeller();
  const queryClient = useQueryClient();
  const key = ["seller", "discounts", store.id];
  const discounts = useQuery({ queryKey: key, queryFn: () => discountsService.list(store.id) });
  const [editing, setEditing] = useState<Discount | null | undefined>(undefined);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const save = useMutation({
    mutationFn: (args: { id?: string; input: DiscountInput }) =>
      args.id
        ? discountsService.update(args.id, args.input)
        : discountsService.create(store.id, args.input),
    onSuccess: async (_d, args) => {
      toast.success(args.id ? "Discount saved" : "Discount created");
      setEditing(undefined);
      await refresh();
    },
    onError: (e) => toast.error(discountError(e)),
  });
  const toggle = useMutation({
    mutationFn: (d: Discount) => discountsService.setActive(d.id, !d.is_active),
    onSuccess: (_d, d) => toast.success(`${d.code} ${d.is_active ? "disabled" : "enabled"}`),
    onError: (e) => toast.error(discountError(e)),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (d: Discount) => discountsService.remove(d.id),
    onSuccess: (_d, d) => toast.success(`${d.code} deleted`),
    onError: (e) => toast.error(discountError(e)),
    onSettled: refresh,
  });

  return (
    <div className="seller-page">
      <SellerPageHeader
        title="Discounts"
        description={`Codes shoppers can use on ${store.name}'s products at checkout.`}
        actions={
          <Button onClick={() => setEditing(null)}>
            <Plus /> Create discount
          </Button>
        }
      />
      <PanelState
        query={discounts}
        errorText="Your discounts could not be loaded."
        empty={{
          title: "No discount codes yet",
          description: "Create a code to offer a percentage or fixed amount off.",
        }}
      >
        {(list) => (
          <ul className="seller-list">
            {list.map((d) => {
              const state = discountState(d);
              const busy =
                (toggle.isPending && toggle.variables?.id === d.id) ||
                (remove.isPending && remove.variables?.id === d.id);
              return (
                <li key={d.id} className="seller-row">
                  <div className="min-w-0 flex-1">
                    <h3 className="seller-row-title font-mono">{d.code}</h3>
                    <p className="seller-row-meta">
                      {describeValue(d)}
                      {d.min_subtotal != null && <> · min {money(d.min_subtotal)}</>}
                      <span aria-hidden>·</span>
                      Used {d.used_count} / {d.max_uses ?? "∞"}
                      {d.ends_at && <> · ends {new Date(d.ends_at).toLocaleDateString()}</>}
                    </p>
                  </div>
                  <Badge variant={state === "Active" ? "default" : "secondary"}>{state}</Badge>
                  <label className="flex items-center gap-2 text-sm">
                    <Switch
                      checked={d.is_active}
                      disabled={busy}
                      onCheckedChange={() => toggle.mutate(d)}
                      aria-label={`${d.is_active ? "Disable" : "Enable"} ${d.code}`}
                    />
                  </label>
                  <div className="seller-row-actions">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Edit ${d.code}`}
                      title="Edit"
                      onClick={() => setEditing(d)}
                    >
                      <Pencil size={15} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete ${d.code}`}
                      title="Delete"
                      disabled={busy}
                      onClick={() =>
                        setConfirm({
                          title: `Delete ${d.code}?`,
                          description:
                            d.used_count > 0
                              ? `It has been used ${d.used_count} time${d.used_count === 1 ? "" : "s"}. Past orders keep their discount; the code just stops working. To pause it instead, disable it.`
                              : "Shoppers will no longer be able to use this code.",
                          confirmLabel: "Delete code",
                          destructive: true,
                          run: () => remove.mutateAsync(d),
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PanelState>

      <Dialog
        open={editing !== undefined}
        onOpenChange={(o) => !o && !save.isPending && setEditing(undefined)}
      >
        <DialogContent className="seller-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.code}` : "Create a discount"}</DialogTitle>
            <DialogDescription>
              The discount is checked and applied by Saloree when the order is placed.
            </DialogDescription>
          </DialogHeader>
          {editing !== undefined && (
            <DiscountForm
              key={editing?.id ?? "new"}
              discount={editing}
              busy={save.isPending}
              onCancel={() => setEditing(undefined)}
              onSubmit={(input) =>
                save.mutateAsync(editing ? { id: editing.id, input } : { input })
              }
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog request={confirm} busy={remove.isPending} onClose={() => setConfirm(null)} />
    </div>
  );
}
