import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { PanelState } from "@/components/seller/panel-state";
import type { CategoryRow } from "@/data/db";
import { adminService, categoryInputSchema, type CategoryInput } from "@/services/admin";
import { slugify } from "@/services/seller";
import { ConfirmDialog, type ConfirmRequest } from "./confirm-dialog";
import { adminKeys } from "./keys";
import { useAdminAction } from "./use-admin-action";

type Category = CategoryRow & { productCount: number };
const CATEGORY_ERRORS = {
  "23505": "A category with that slug already exists.",
  "23503": "Products still use this category. Move them to another category first.",
};

function CategoryForm({
  category,
  busy,
  onSubmit,
  onCancel,
}: {
  category: Category | null;
  busy: boolean;
  onSubmit: (values: CategoryInput) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [slug, setSlug] = useState(category?.slug ?? "");
  const [slugEdited, setSlugEdited] = useState(!!category);
  const [errors, setErrors] = useState<{ name?: string | undefined; slug?: string | undefined }>(
    {},
  );
  return (
    <form
      className="seller-form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = categoryInputSchema.safeParse({ name, slug });
        if (!parsed.success) {
          const fe = parsed.error.flatten().fieldErrors;
          return setErrors({ name: fe.name?.[0], slug: fe.slug?.[0] });
        }
        setErrors({});
        await onSubmit(parsed.data).catch(() => {});
      }}
    >
      <div className="seller-field">
        <Label htmlFor="category-name">Name</Label>
        <Input
          id="category-name"
          value={name}
          maxLength={60}
          aria-invalid={!!errors.name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(slugify(e.target.value));
          }}
        />
        {errors.name && <p className="seller-error">{errors.name}</p>}
      </div>
      <div className="seller-field">
        <Label htmlFor="category-slug">Slug</Label>
        <Input
          id="category-slug"
          value={slug}
          maxLength={60}
          aria-invalid={!!errors.slug}
          onChange={(e) => {
            setSlugEdited(true);
            setSlug(e.target.value.toLowerCase());
          }}
          onBlur={() => setSlug(slugify(slug))}
        />
        {errors.slug ? (
          <p className="seller-error">{errors.slug}</p>
        ) : (
          <p className="seller-hint">
            Used in the address /category/{slug || "…"}
            {category &&
              category.slug !== slug &&
              " — existing links to the old address will break."}
          </p>
        )}
      </div>
      <div className="seller-form-actions">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : category ? "Save category" : "Add category"}
        </Button>
      </div>
    </form>
  );
}

export function CategoriesPanel() {
  const categories = useQuery({
    queryKey: adminKeys.categories,
    queryFn: adminService.listCategories,
  });
  // undefined = closed, null = new, category = editing.
  const [editing, setEditing] = useState<Category | null | undefined>(undefined);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const save = useAdminAction(
    (v: { id?: string; values: CategoryInput }) =>
      v.id ? adminService.updateCategory(v.id, v.values) : adminService.createCategory(v.values),
    { success: (v) => `${v.values.name} ${v.id ? "updated" : "added"}`, errors: CATEGORY_ERRORS },
  );
  const remove = useAdminAction((c: Category) => adminService.deleteCategory(c.id), {
    success: (c) => `${c.name} deleted`,
    errors: CATEGORY_ERRORS,
  });

  return (
    <section aria-labelledby="admin-categories-heading">
      <div className="seller-panel-head">
        <div>
          <h2 id="admin-categories-heading">Categories</h2>
          <p>Sellers choose from these when adding products.</p>
        </div>
        <Button onClick={() => setEditing(null)}>
          <Plus />
          Add category
        </Button>
      </div>
      <PanelState
        query={categories}
        errorText="Categories could not be loaded."
        empty={{ title: "No categories yet", description: "Add one so sellers can list products." }}
      >
        {(list) => (
          <ul className="seller-list">
            {list.map((c) => (
              <li key={c.id} className="seller-row">
                <div className="min-w-0 flex-1">
                  <h3 className="seller-row-title">{c.name}</h3>
                  <p className="seller-row-meta">
                    /category/{c.slug}
                    <span aria-hidden>·</span>
                    {c.productCount} product{c.productCount === 1 ? "" : "s"}
                    {c.productCount > 0 && (
                      <>
                        <span aria-hidden>·</span>
                        <span>Can't be deleted while products use it</span>
                      </>
                    )}
                  </p>
                </div>
                <div className="seller-row-actions">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Edit ${c.name}`}
                    title="Edit"
                    onClick={() => setEditing(c)}
                  >
                    <Pencil size={15} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Delete ${c.name}`}
                    title={
                      c.productCount > 0
                        ? `${c.productCount} product${c.productCount === 1 ? " uses" : "s use"} this category — move them first`
                        : "Delete"
                    }
                    // A category that still has products can't be deleted.
                    disabled={c.productCount > 0}
                    onClick={() =>
                      setConfirm({
                        title: `Delete ${c.name}?`,
                        description: "This category will be removed permanently.",
                        confirmLabel: "Delete category",
                        destructive: true,
                        run: () => remove.mutateAsync(c),
                      })
                    }
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PanelState>

      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => !open && !save.isPending && setEditing(undefined)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit category" : "Add a category"}</DialogTitle>
            <DialogDescription>Name and address slug.</DialogDescription>
          </DialogHeader>
          {editing !== undefined && (
            <CategoryForm
              key={editing?.id ?? "new"}
              category={editing}
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
