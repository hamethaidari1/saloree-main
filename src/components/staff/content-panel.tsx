import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageOff, Info, Pencil, Plus, Trash2, Upload } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { PanelState } from "@/components/seller/panel-state";
import { ConfirmDialog, type ConfirmRequest } from "@/components/admin/confirm-dialog";
import { adminKeys } from "@/components/admin/keys";
import { useAdminAction } from "@/components/admin/use-admin-action";
import { friendlyError } from "@/services/errors";
import {
  CONTENT_SCHEMAS,
  marketplaceService,
  type ContentRow,
  type ContentTable,
} from "@/services/marketplace";

type FieldKind = "text" | "textarea" | "link" | "image" | "number" | "switch";
interface Field {
  key: string;
  label: string;
  kind: FieldKind;
  hint?: string;
}
interface TableUi {
  title: string;
  description: string;
  /** True when the storefront doesn't read this table yet (said plainly in the UI). */
  notLive?: boolean;
  noun: string;
  fields: Field[];
  title_of: (row: Record<string, unknown>) => string;
  meta_of: (row: Record<string, unknown>) => string;
  image_of?: (row: Record<string, unknown>) => string | null;
  active_key: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export const CONTENT_UI: Record<ContentTable, TableUi> = {
  hero_slides: {
    title: "Hero slides",
    description: "Images for the home page slideshow.",
    notLive: true,
    noun: "slide",
    fields: [
      { key: "image_url", label: "Image", kind: "image" },
      { key: "alt_text", label: "Image description (for screen readers)", kind: "text" },
      { key: "display_order", label: "Order", kind: "number", hint: "Lower numbers show first." },
      { key: "is_active", label: "Active", kind: "switch" },
    ],
    title_of: (r) => str(r["alt_text"]) || "Untitled slide",
    meta_of: (r) => `Order ${String(r["display_order"] ?? 0)}`,
    image_of: (r) => str(r["image_url"]) || null,
    active_key: "is_active",
  },
  homepage_sections: {
    title: "Homepage sections",
    description: "Which sections the home page shows, their titles and order.",
    notLive: true,
    noun: "section",
    fields: [
      {
        key: "section_key",
        label: "Section key",
        kind: "text",
        hint: "e.g. categories, featured, stores",
      },
      { key: "title", label: "Title", kind: "text" },
      { key: "display_order", label: "Order", kind: "number" },
      { key: "is_visible", label: "Visible", kind: "switch" },
    ],
    title_of: (r) => str(r["title"]) || str(r["section_key"]),
    meta_of: (r) => `${str(r["section_key"])} · order ${String(r["display_order"] ?? 0)}`,
    active_key: "is_visible",
  },
  promo_banners: {
    title: "Promo banners",
    description: "Banners with an image, short text and a button.",
    notLive: true,
    noun: "banner",
    fields: [
      { key: "image_url", label: "Image", kind: "image" },
      { key: "title", label: "Title", kind: "text" },
      { key: "subtitle", label: "Subtitle", kind: "textarea" },
      { key: "button_text", label: "Button text", kind: "text" },
      {
        key: "button_link",
        label: "Button link",
        kind: "link",
        hint: "A path like /stores or an https:// address.",
      },
      { key: "display_order", label: "Order", kind: "number" },
      { key: "is_active", label: "Active", kind: "switch" },
    ],
    title_of: (r) => str(r["title"]) || "Untitled banner",
    meta_of: (r) =>
      [str(r["button_text"]), str(r["button_link"])].filter(Boolean).join(" → ") || "No button",
    image_of: (r) => str(r["image_url"]) || null,
    active_key: "is_active",
  },
  footer_links: {
    title: "Footer links",
    description:
      "When at least one link exists, the footer shows these columns instead of the built-in ones. Links to pages that don't exist are hidden automatically.",
    noun: "link",
    fields: [
      { key: "category", label: "Column", kind: "text", hint: "e.g. Help, Shop, Sell on Saloree" },
      { key: "label", label: "Label", kind: "text" },
      {
        key: "url",
        label: "Link",
        kind: "link",
        hint: "A path like /help or an https:// address.",
      },
      { key: "display_order", label: "Order", kind: "number" },
      { key: "is_active", label: "Active", kind: "switch" },
    ],
    title_of: (r) => str(r["label"]),
    meta_of: (r) => `${str(r["category"])} · ${str(r["url"])}`,
    active_key: "is_active",
  },
};

type Values = Record<string, string | boolean>;

function initialValues(ui: TableUi, row: Record<string, unknown> | null): Values {
  const v: Values = {};
  for (const f of ui.fields) {
    const cur = row?.[f.key];
    v[f.key] =
      f.kind === "switch"
        ? cur === undefined || cur === null
          ? true
          : !!cur
        : cur === null || cur === undefined
          ? f.kind === "number"
            ? "0"
            : ""
          : String(cur);
  }
  return v;
}

function ImageField({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="grid gap-2">
      {value ? (
        <img src={value} alt="" className="staff-image-preview" />
      ) : (
        <div className="staff-image-preview staff-image-empty">
          <ImageOff aria-hidden />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Input
          id={id}
          type="url"
          inputMode="url"
          placeholder="https://…"
          value={value}
          aria-invalid={invalid}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => file.current?.click()}
        >
          <Upload />
          {busy ? "Uploading…" : "Upload"}
        </Button>
        <input
          ref={file}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            setBusy(true);
            setError(null);
            try {
              onChange(await marketplaceService.uploadContentImage(f));
            } catch (err) {
              setError(friendlyError(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
      {error && (
        <p role="alert" className="seller-error">
          {error}
        </p>
      )}
    </div>
  );
}

function ContentForm({
  table,
  row,
  busy,
  onSubmit,
  onCancel,
}: {
  table: ContentTable;
  row: Record<string, unknown> | null;
  busy: boolean;
  onSubmit: (values: Values) => Promise<unknown>;
  onCancel: () => void;
}) {
  const ui = CONTENT_UI[table];
  const [values, setValues] = useState<Values>(() => initialValues(ui, row));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: string, v: string | boolean) => setValues((cur) => ({ ...cur, [k]: v }));
  return (
    <form
      className="seller-form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = CONTENT_SCHEMAS[table].safeParse(values);
        if (!parsed.success) {
          const fe = parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>;
          setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? ""])));
          return;
        }
        setErrors({});
        await onSubmit(values).catch(() => {});
      }}
    >
      {ui.fields.map((f) => {
        const id = `${table}-${f.key}`;
        const err = errors[f.key];
        const value = values[f.key];
        return (
          <div key={f.key} className="seller-field">
            {f.kind === "switch" ? (
              <div className="flex items-center gap-3">
                <Switch id={id} checked={value === true} onCheckedChange={(c) => set(f.key, c)} />
                <Label htmlFor={id}>{f.label}</Label>
              </div>
            ) : (
              <>
                <Label htmlFor={id}>{f.label}</Label>
                {f.kind === "image" ? (
                  <ImageField
                    id={id}
                    value={String(value ?? "")}
                    invalid={!!err}
                    onChange={(v) => set(f.key, v)}
                  />
                ) : f.kind === "textarea" ? (
                  <Textarea
                    id={id}
                    rows={3}
                    value={String(value ?? "")}
                    aria-invalid={!!err}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                ) : (
                  <Input
                    id={id}
                    type={f.kind === "number" ? "number" : "text"}
                    inputMode={f.kind === "number" ? "numeric" : undefined}
                    min={f.kind === "number" ? 0 : undefined}
                    value={String(value ?? "")}
                    aria-invalid={!!err}
                    onChange={(e) => set(f.key, e.target.value)}
                  />
                )}
              </>
            )}
            {err ? (
              <p className="seller-error">{err}</p>
            ) : (
              f.hint && <p className="seller-hint">{f.hint}</p>
            )}
          </div>
        );
      })}
      <div className="seller-form-actions">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : row ? `Save ${ui.noun}` : `Add ${ui.noun}`}
        </Button>
      </div>
    </form>
  );
}

/** List + add/edit/delete for one homepage content table. */
export function ContentPanel({ table }: { table: ContentTable }) {
  const ui = CONTENT_UI[table];
  const rows = useQuery({
    queryKey: [...adminKeys.all, "content", table],
    queryFn: () => marketplaceService.listContent(table),
    retry: false,
  });
  // undefined = closed, null = new, row = editing
  const [editing, setEditing] = useState<ContentRow<ContentTable> | null | undefined>(undefined);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const save = useAdminAction(
    (v: { id?: string; values: Values }) =>
      v.id
        ? marketplaceService.updateContent(table, v.id, v.values)
        : marketplaceService.createContent(table, v.values),
    {
      success: (v) => `${ui.noun[0]!.toUpperCase()}${ui.noun.slice(1)} ${v.id ? "saved" : "added"}`,
    },
  );
  const remove = useAdminAction((id: string) => marketplaceService.deleteContent(table, id), {
    success: () => `${ui.noun[0]!.toUpperCase()}${ui.noun.slice(1)} deleted`,
  });

  return (
    <section className="staff-content" aria-labelledby={`content-${table}`}>
      <div className="seller-panel-head">
        <div>
          <h3 id={`content-${table}`} className="text-base font-semibold">
            {ui.title}
          </h3>
          <p>{ui.description}</p>
        </div>
        <Button onClick={() => setEditing(null)}>
          <Plus />
          Add {ui.noun}
        </Button>
      </div>
      {ui.notLive && (
        <p className="staff-note" role="note">
          <Info aria-hidden size={16} />
          Saved in the database, but the live home page doesn't read this yet.
        </p>
      )}
      <PanelState
        query={rows}
        errorText={`${ui.title} could not be loaded.`}
        empty={{ title: `No ${ui.noun}s yet`, description: `Add the first ${ui.noun}.` }}
      >
        {(list) => (
          <ul className="seller-list">
            {list.map((row) => {
              const r = row as unknown as Record<string, unknown>;
              const img = ui.image_of?.(r);
              const on = r[ui.active_key] !== false;
              return (
                <li key={row.id} className="seller-row">
                  {ui.image_of && (
                    <div className="seller-thumb">
                      {img ? <img src={img} alt="" loading="lazy" /> : <ImageOff aria-hidden />}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="seller-row-title" dir="auto">
                      {ui.title_of(r)}
                    </p>
                    <p className="seller-row-meta" dir="auto">
                      {ui.meta_of(r)}
                    </p>
                  </div>
                  <Badge variant={on ? "default" : "secondary"}>{on ? "On" : "Off"}</Badge>
                  <div className="seller-row-actions">
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Edit ${ui.title_of(r)}`}
                      onClick={() => setEditing(row)}
                    >
                      <Pencil size={15} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Delete ${ui.title_of(r)}`}
                      onClick={() =>
                        setConfirm({
                          title: `Delete this ${ui.noun}?`,
                          description: `“${ui.title_of(r)}” will be removed permanently.`,
                          confirmLabel: `Delete ${ui.noun}`,
                          destructive: true,
                          run: () => remove.mutateAsync(row.id),
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
        onOpenChange={(open) => !open && !save.isPending && setEditing(undefined)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${ui.noun}` : `Add a ${ui.noun}`}</DialogTitle>
            <DialogDescription>{ui.description}</DialogDescription>
          </DialogHeader>
          {editing !== undefined && (
            <ContentForm
              key={editing?.id ?? "new"}
              table={table}
              row={editing as unknown as Record<string, unknown> | null}
              busy={save.isPending}
              onCancel={() => setEditing(undefined)}
              onSubmit={async (values) => {
                await save.mutateAsync(editing ? { id: editing.id, values } : { values });
                setEditing(undefined);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog request={confirm} busy={remove.isPending} onClose={() => setConfirm(null)} />
    </section>
  );
}
