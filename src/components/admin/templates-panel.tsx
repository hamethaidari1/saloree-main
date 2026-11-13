import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog, type ConfirmRequest } from "@/components/marketplace/confirm-dialog";
import { formatPrice } from "@/components/seller/theme-data";
import type { StoreTemplateRow } from "@/data/db";
import { adminService } from "@/services/admin";
import {
  centsToPrice,
  priceToCents,
  templateAdminSchema,
  templatesAdminService,
  themeError,
  type TemplateAdminInput,
} from "@/services/themes";
import { adminKeys } from "./keys";

function TemplateForm({
  row,
  busy,
  onSubmit,
  onCancel,
}: {
  row: StoreTemplateRow;
  busy: boolean;
  onSubmit: (v: TemplateAdminInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [v, setV] = useState({
    name: row.name,
    description: row.description ?? "",
    category: row.category ?? "",
    is_premium: row.is_premium,
    price: centsToPrice(row.price_cents),
    currency: row.currency ?? "USD",
    is_active: row.is_active,
    sort_order: String(row.sort_order),
  });
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const set = (k: keyof typeof v, value: string | boolean) => setV((s) => ({ ...s, [k]: value }));
  return (
    <form
      className="seller-form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        let price_cents: number | null;
        try {
          price_cents = priceToCents(v.price);
        } catch (err) {
          return setErrors({ price: (err as Error).message });
        }
        const input = {
          name: v.name,
          description: v.description,
          category: v.category,
          is_premium: v.is_premium,
          price_cents,
          currency: v.currency,
          is_active: v.is_active,
          sort_order: Number(v.sort_order),
        };
        const parsed = templateAdminSchema.safeParse(input);
        if (!parsed.success)
          return setErrors(
            Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])),
          );
        setErrors({});
        await onSubmit(input).catch(() => {});
      }}
    >
      <div className="seller-form-row">
        <div className="seller-field">
          <Label htmlFor="tpl-name">Name</Label>
          <Input
            id="tpl-name"
            value={v.name}
            maxLength={80}
            onChange={(e) => set("name", e.target.value)}
          />
          {errors["name"] && <p className="seller-error">{errors["name"]}</p>}
        </div>
        <div className="seller-field">
          <Label htmlFor="tpl-category">Category</Label>
          <Input
            id="tpl-category"
            value={v.category}
            maxLength={40}
            placeholder="e.g. Fashion"
            onChange={(e) => set("category", e.target.value)}
          />
        </div>
      </div>
      <div className="seller-field">
        <Label htmlFor="tpl-desc">Description</Label>
        <Input
          id="tpl-desc"
          value={v.description}
          maxLength={500}
          onChange={(e) => set("description", e.target.value)}
        />
      </div>
      <label className="flex items-center gap-3 text-sm">
        <Switch checked={v.is_premium} onCheckedChange={(c) => set("is_premium", c)} />
        Premium (stores need an unlock to use it)
      </label>
      <div className="seller-form-row three">
        <div className="seller-field">
          <Label htmlFor="tpl-price">Price</Label>
          <Input
            id="tpl-price"
            inputMode="decimal"
            placeholder="None"
            value={v.price}
            onChange={(e) => set("price", e.target.value)}
          />
          {(errors["price"] ?? errors["price_cents"]) ? (
            <p className="seller-error">{errors["price"] ?? errors["price_cents"]}</p>
          ) : (
            <p className="seller-hint">Shown on premium cards. Empty = no price.</p>
          )}
        </div>
        <div className="seller-field">
          <Label htmlFor="tpl-currency">Currency</Label>
          <Input
            id="tpl-currency"
            value={v.currency}
            maxLength={3}
            onChange={(e) => set("currency", e.target.value.toUpperCase())}
          />
          {errors["currency"] && <p className="seller-error">{errors["currency"]}</p>}
        </div>
        <div className="seller-field">
          <Label htmlFor="tpl-sort">Sort order</Label>
          <Input
            id="tpl-sort"
            type="number"
            min={0}
            step={1}
            value={v.sort_order}
            onChange={(e) => set("sort_order", e.target.value)}
          />
          {errors["sort_order"] && <p className="seller-error">{errors["sort_order"]}</p>}
        </div>
      </div>
      <label className="flex items-center gap-3 text-sm">
        <Switch checked={v.is_active} onCheckedChange={(c) => set("is_active", c)} />
        Active — shown in sellers' theme library
      </label>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save template"}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function TemplatesPanel() {
  const queryClient = useQueryClient();
  const templates = useQuery({
    queryKey: adminKeys.templates,
    queryFn: templatesAdminService.listAll,
    retry: false,
  });
  const grants = useQuery({
    queryKey: adminKeys.templateGrants,
    queryFn: templatesAdminService.listGrants,
    retry: false,
  });
  const stores = useQuery({ queryKey: adminKeys.stores, queryFn: adminService.listStores });
  const [editing, setEditing] = useState<StoreTemplateRow | null>(null);
  const [grantTemplate, setGrantTemplate] = useState("");
  const [grantStore, setGrantStore] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.templates }),
      queryClient.invalidateQueries({ queryKey: adminKeys.templateGrants }),
      queryClient.invalidateQueries({ queryKey: ["store-templates"] }),
      queryClient.invalidateQueries({ queryKey: ["store-template-grants"] }),
    ]);

  const save = useMutation({
    mutationFn: (a: { id: string; input: TemplateAdminInput }) =>
      templatesAdminService.update(a.id, a.input),
    onSuccess: async () => {
      toast.success("Template saved");
      setEditing(null);
      await refresh();
    },
    onError: (e) => toast.error(themeError(e)),
  });
  const toggle = useMutation({
    mutationFn: (row: StoreTemplateRow) =>
      templatesAdminService.update(row.id, {
        name: row.name,
        description: row.description ?? "",
        category: row.category ?? "",
        is_premium: row.is_premium,
        price_cents: row.price_cents,
        currency: row.currency ?? "USD",
        is_active: !row.is_active,
        sort_order: row.sort_order,
      }),
    onSuccess: (_d, row) =>
      toast.success(`${row.name} ${row.is_active ? "deactivated" : "activated"}`),
    onError: (e) => toast.error(themeError(e)),
    onSettled: refresh,
  });
  const grant = useMutation({
    mutationFn: () => templatesAdminService.grant(grantStore, grantTemplate),
    onSuccess: async () => {
      toast.success("Template unlocked for the store");
      setGrantStore("");
      await refresh();
    },
    onError: (e) => toast.error(themeError(e)),
  });
  const revoke = useMutation({
    mutationFn: (g: { storeId: string; templateId: string }) =>
      templatesAdminService.revoke(g.storeId, g.templateId),
    onSuccess: () => toast.success("Unlock removed"),
    onError: (e) => toast.error(themeError(e)),
    onSettled: refresh,
  });

  const error = templates.error ?? grants.error;
  if (error)
    return (
      <div role="alert" className="seller-empty">
        <h3>Templates could not be loaded.</h3>
        <p>{themeError(error)}</p>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          Try again
        </Button>
      </div>
    );
  if (!templates.data || !grants.data)
    return <div className="nav-skeleton" aria-busy="true" aria-label="Loading templates" />;

  const premium = templates.data.filter((t) => t.is_premium);
  const already = new Set(grants.data.map((g) => `${g.store_id}|${g.template_id}`));

  return (
    <div className="grid gap-8">
      <section aria-labelledby="admin-templates">
        <div className="seller-panel-head">
          <div>
            <h2 id="admin-templates">Store templates</h2>
            <p>Templates are never deleted — deactivate one to hide it from sellers.</p>
          </div>
        </div>
        <ul className="seller-list">
          {templates.data.map((row) => (
            <li key={row.id} className="seller-row">
              <div className="min-w-0 flex-1">
                <h3 className="seller-row-title">
                  {row.name} <span className="font-mono text-xs font-normal">{row.code}</span>
                </h3>
                <p className="seller-row-meta">
                  {row.category ?? "No category"}
                  <span aria-hidden>·</span>
                  order {row.sort_order}
                  {row.is_premium && formatPrice(row.price_cents, row.currency) && (
                    <>
                      <span aria-hidden>·</span>
                      {formatPrice(row.price_cents, row.currency)}
                    </>
                  )}
                </p>
              </div>
              <Badge variant={row.is_premium ? "default" : "secondary"}>
                {row.is_premium ? "Premium" : "Free"}
              </Badge>
              <Badge variant={row.is_active ? "outline" : "secondary"}>
                {row.is_active ? "active" : "inactive"}
              </Badge>
              <Switch
                checked={row.is_active}
                disabled={toggle.isPending && toggle.variables?.id === row.id}
                onCheckedChange={() => toggle.mutate(row)}
                aria-label={`${row.is_active ? "Deactivate" : "Activate"} ${row.name}`}
              />
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Edit ${row.name}`}
                onClick={() => setEditing(row)}
              >
                <Pencil size={15} />
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="admin-grants" className="grid gap-4">
        <div className="seller-panel-head">
          <div>
            <h2 id="admin-grants">Premium unlocks</h2>
            <p>Unlock a premium template for a store (recorded as an admin grant).</p>
          </div>
        </div>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (grantStore && grantTemplate) grant.mutate();
          }}
        >
          <label className="seller-field min-w-48">
            <span className="seller-label">Premium template</span>
            <select
              className="seller-select"
              value={grantTemplate}
              onChange={(e) => setGrantTemplate(e.target.value)}
            >
              <option value="">Choose a template</option>
              {premium.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="seller-field min-w-56 flex-1">
            <span className="seller-label">Store</span>
            <select
              className="seller-select"
              value={grantStore}
              disabled={stores.isPending}
              onChange={(e) => setGrantStore(e.target.value)}
            >
              <option value="">{stores.isPending ? "Loading stores…" : "Choose a store"}</option>
              {(stores.data ?? [])
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((s) => (
                  <option
                    key={s.id}
                    value={s.id}
                    disabled={!!grantTemplate && already.has(`${s.id}|${grantTemplate}`)}
                  >
                    {s.name} ({s.slug}){s.status !== "published" ? " — draft" : ""}
                  </option>
                ))}
            </select>
          </label>
          <Button type="submit" disabled={!grantStore || !grantTemplate || grant.isPending}>
            <Unlock /> Unlock
          </Button>
        </form>
        {stores.error && <p className="seller-error">{themeError(stores.error)}</p>}
        {grants.data.length === 0 ? (
          <p className="seller-hint">No store has a premium template unlocked yet.</p>
        ) : (
          <div className="seller-card overflow-x-auto p-0">
            <table className="seller-table">
              <thead>
                <tr>
                  <th scope="col">Store</th>
                  <th scope="col">Template</th>
                  <th scope="col">Source</th>
                  <th scope="col">Since</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {grants.data.map((g) => (
                  <tr key={`${g.store_id}|${g.template_id}`}>
                    <td>{g.stores?.name ?? g.store_id}</td>
                    <td>{g.store_templates?.name ?? g.template_id}</td>
                    <td>{g.source === "admin_grant" ? "Admin" : g.source}</td>
                    <td>{new Date(g.created_at).toLocaleDateString()}</td>
                    <td className="text-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setConfirm({
                            title: "Remove this unlock?",
                            description: `${g.stores?.name ?? "The store"} won't be able to choose ${g.store_templates?.name ?? "this template"} anymore.`,
                            confirmLabel: "Remove unlock",
                            destructive: true,
                            run: () =>
                              revoke.mutateAsync({
                                storeId: g.store_id,
                                templateId: g.template_id,
                              }),
                          })
                        }
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Dialog open={!!editing} onOpenChange={(o) => !o && !save.isPending && setEditing(null)}>
        <DialogContent className="seller-dialog">
          <DialogHeader>
            <DialogTitle>Edit {editing?.name}</DialogTitle>
            <DialogDescription>
              The template's code ({editing?.code}) can't be changed.
            </DialogDescription>
          </DialogHeader>
          {editing && (
            <TemplateForm
              key={editing.id}
              row={editing}
              busy={save.isPending}
              onCancel={() => setEditing(null)}
              onSubmit={(input) => save.mutateAsync({ id: editing.id, input })}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog request={confirm} busy={revoke.isPending} onClose={() => setConfirm(null)} />
    </div>
  );
}
