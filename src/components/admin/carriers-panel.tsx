import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Pencil, Plus } from "lucide-react";
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
import { PanelState } from "@/components/seller/panel-state";
import type { CarrierRow } from "@/data/db";
import { fillTrackingTemplate, TRACKING_NUMBER_PLACEHOLDER } from "@/lib/tracking";
import {
  carrierError,
  carrierInputSchema,
  carriersService,
  type CarrierInput,
} from "@/services/shipping";
import { adminKeys } from "./keys";

/** Sample number used by "Test link" to open the carrier's page. */
export const SAMPLE_TRACKING_NUMBER = "TEST1234567890";

function TestLink({ template }: { template: string | null }) {
  const href = fillTrackingTemplate(template, SAMPLE_TRACKING_NUMBER);
  if (!href) return null;
  return (
    <Button asChild size="sm" variant="ghost">
      <a href={href} target="_blank" rel="noopener noreferrer">
        Test link <ExternalLink aria-hidden />
        <span className="sr-only"> (opens with a sample tracking number in a new tab)</span>
      </a>
    </Button>
  );
}

function CarrierForm({
  carrier,
  busy,
  onSubmit,
  onCancel,
}: {
  carrier: CarrierRow | null;
  busy: boolean;
  onSubmit: (v: CarrierInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [v, setV] = useState({
    name: carrier?.name ?? "",
    code: carrier?.code ?? "",
    tracking_url_template: carrier?.tracking_url_template ?? "",
    is_active: carrier?.is_active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  return (
    <form
      className="seller-form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = carrierInputSchema.safeParse(v);
        if (!parsed.success)
          return setErrors(
            Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
          );
        setErrors({});
        await onSubmit(v).catch(() => {});
      }}
    >
      <div className="seller-form-row">
        <div className="seller-field">
          <Label htmlFor="carrier-name">Name</Label>
          <Input
            id="carrier-name"
            value={v.name}
            maxLength={80}
            onChange={(e) => setV((s) => ({ ...s, name: e.target.value }))}
          />
          {errors["name"] && <p className="seller-error">{errors["name"]}</p>}
        </div>
        <div className="seller-field">
          <Label htmlFor="carrier-code">Code</Label>
          <Input
            id="carrier-code"
            value={v.code}
            maxLength={32}
            spellCheck={false}
            onChange={(e) =>
              setV((s) => ({
                ...s,
                code: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ""),
              }))
            }
          />
          {errors["code"] ? (
            <p className="seller-error">{errors["code"]}</p>
          ) : (
            <p className="seller-hint">A short, unique ID, e.g. dhl, aramex.</p>
          )}
        </div>
      </div>
      <div className="seller-field">
        <Label htmlFor="carrier-template">Tracking URL template</Label>
        <Input
          id="carrier-template"
          value={v.tracking_url_template}
          placeholder={`https://carrier.example/track?number=${TRACKING_NUMBER_PLACEHOLDER}`}
          spellCheck={false}
          onChange={(e) => setV((s) => ({ ...s, tracking_url_template: e.target.value }))}
        />
        {errors["tracking_url_template"] ? (
          <p className="seller-error">{errors["tracking_url_template"]}</p>
        ) : (
          <p className="seller-hint">
            Must start with https:// and contain {TRACKING_NUMBER_PLACEHOLDER} where the number
            goes.
          </p>
        )}
        <TestLink template={v.tracking_url_template} />
      </div>
      <label className="flex items-center gap-3 text-sm">
        <Switch
          checked={v.is_active}
          onCheckedChange={(c) => setV((s) => ({ ...s, is_active: c }))}
        />
        Active — sellers can pick this carrier
      </label>
      <div className="seller-form-actions">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : carrier ? "Save carrier" : "Add carrier"}
        </Button>
      </div>
    </form>
  );
}

export function CarriersPanel() {
  const queryClient = useQueryClient();
  const carriers = useQuery({
    queryKey: adminKeys.carriers,
    queryFn: carriersService.listAll,
    retry: false,
  });
  const [editing, setEditing] = useState<CarrierRow | null | undefined>(undefined);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.carriers }),
      queryClient.invalidateQueries({ queryKey: ["carriers"] }),
    ]);
  const save = useMutation({
    mutationFn: (a: { id?: string; input: CarrierInput }) =>
      a.id ? carriersService.update(a.id, a.input) : carriersService.create(a.input),
    onSuccess: async (_d, a) => {
      toast.success(a.id ? "Carrier saved" : "Carrier added");
      setEditing(undefined);
      await refresh();
    },
    onError: (e) => toast.error(carrierError(e)),
  });
  const toggle = useMutation({
    mutationFn: (c: CarrierRow) => carriersService.setActive(c.id, !c.is_active),
    onSuccess: (_d, c) => toast.success(`${c.name} ${c.is_active ? "disabled" : "enabled"}`),
    onError: (e) => toast.error(carrierError(e)),
    onSettled: refresh,
  });

  return (
    <section aria-labelledby="admin-carriers-heading">
      <div className="seller-panel-head">
        <div>
          <h2 id="admin-carriers-heading">Carriers</h2>
          <p>Shipping companies sellers can choose when adding tracking.</p>
        </div>
        <Button onClick={() => setEditing(null)} disabled={carriers.isError}>
          <Plus /> Add carrier
        </Button>
      </div>
      {carriers.isError ? (
        <div role="alert" className="seller-empty">
          <h3>Carriers could not be loaded.</h3>
          <p>{carrierError(carriers.error)}</p>
        </div>
      ) : (
        <PanelState
          query={carriers}
          errorText="Carriers could not be loaded."
          empty={{ title: "No carriers yet", description: "Add the carriers sellers ship with." }}
        >
          {(list) => (
            <ul className="seller-list">
              {list.map((c) => (
                <li key={c.id} className="seller-row">
                  <div className="min-w-0 flex-1">
                    <h3 className="seller-row-title">
                      {c.name} <span className="font-mono text-xs font-normal">{c.code}</span>
                    </h3>
                    <p className="seller-row-meta break-all">{c.tracking_url_template ?? "—"}</p>
                  </div>
                  <Badge variant={c.is_active ? "default" : "secondary"}>
                    {c.is_active ? "active" : "disabled"}
                  </Badge>
                  <TestLink template={c.tracking_url_template} />
                  <Switch
                    checked={c.is_active}
                    disabled={toggle.isPending && toggle.variables?.id === c.id}
                    onCheckedChange={() => toggle.mutate(c)}
                    aria-label={`${c.is_active ? "Disable" : "Enable"} ${c.name}`}
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Edit ${c.name}`}
                    title="Edit"
                    onClick={() => setEditing(c)}
                  >
                    <Pencil size={15} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </PanelState>
      )}
      <p className="seller-hint mt-3">
        Carriers can't be deleted because existing shipments use them. Disable a carrier to hide it
        from sellers.
      </p>

      <Dialog
        open={editing !== undefined}
        onOpenChange={(o) => !o && !save.isPending && setEditing(undefined)}
      >
        <DialogContent className="seller-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${editing.name}` : "Add a carrier"}</DialogTitle>
            <DialogDescription>Name, code and the link to its tracking page.</DialogDescription>
          </DialogHeader>
          {editing !== undefined && (
            <CarrierForm
              key={editing?.id ?? "new"}
              carrier={editing}
              busy={save.isPending}
              onCancel={() => setEditing(undefined)}
              onSubmit={(input) =>
                save.mutateAsync(editing ? { id: editing.id, input } : { input })
              }
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
