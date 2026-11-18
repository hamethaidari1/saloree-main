import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ImageOff, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CategoryRow, StoreRow } from "@/data/db";
import { money } from "@/services/catalog";
import { friendlyError, sellerService, type SellerProduct } from "@/services/seller";
import { PanelState } from "./panel-state";
import { ProductForm } from "./product-form";

const productsKey = (storeId: string) => ["seller", "products", storeId] as const;

export function ProductsPanel({
  store,
  categories,
}: {
  store: StoreRow;
  categories: CategoryRow[];
}) {
  const queryClient = useQueryClient();
  const products = useQuery({
    queryKey: productsKey(store.id),
    queryFn: () => sellerService.getStoreProducts(store.id),
  });
  // undefined = closed, null = new product, product = editing.
  const [editing, setEditing] = useState<SellerProduct | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<SellerProduct | null>(null);
  // "Photo 2 of 5" while new photos are shrunk and uploaded.
  const [photoProgress, setPhotoProgress] = useState<{ done: number; total: number } | null>(null);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: productsKey(store.id) }),
      queryClient.invalidateQueries({ queryKey: ["catalog"] }),
    ]);

  const save = useMutation({
    mutationFn: (args: Parameters<typeof sellerService.saveProduct>) =>
      sellerService.saveProduct(...args),
    onSettled: () => setPhotoProgress(null),
    onSuccess: async (_d, [, , , existing]) => {
      toast.success(existing ? "Product updated" : "Product added");
      setEditing(undefined);
      await refresh();
    },
    onError: (e) => toast.error(friendlyError(e)),
  });
  const remove = useMutation({
    mutationFn: sellerService.deleteProduct,
    onSuccess: async () => {
      toast.success("Product deleted");
      setDeleting(null);
      await refresh();
    },
    onError: (e) => {
      toast.error(friendlyError(e));
      setDeleting(null);
    },
  });
  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <section aria-labelledby="products-heading">
      <div className="seller-panel-head">
        <div>
          <h2 id="products-heading">Products</h2>
          <p>
            {products.data
              ? `${products.data.length} product${products.data.length === 1 ? "" : "s"}`
              : "Manage what you sell."}
          </p>
        </div>
        <Button onClick={() => setEditing(null)} disabled={!categories.length}>
          <Plus />
          Add product
        </Button>
      </div>

      <PanelState
        query={products}
        errorText="Your products could not be loaded."
        empty={{
          title: "No products yet",
          description: "Add your first product to start building your store.",
        }}
      >
        {(list) => (
          <ul className="seller-list">
            {list.map((p) => (
              <li key={p.id} className="seller-row">
                <div className="seller-thumb">
                  {p.featured_image ? (
                    <img src={p.featured_image} alt="" loading="lazy" />
                  ) : (
                    <ImageOff aria-hidden />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="seller-row-title">{p.title}</h3>
                  <p className="seller-row-meta">
                    {money(Number(p.price))}
                    {p.compare_price != null && (
                      <span className="old-price">{money(Number(p.compare_price))}</span>
                    )}
                    <span aria-hidden>·</span>
                    <span className={p.stock < 1 ? "text-destructive" : undefined}>
                      {p.stock < 1 ? "Out of stock" : `${p.stock} in stock`}
                    </span>
                    <span aria-hidden>·</span>
                    {categoryName(p.category_id)}
                  </p>
                </div>
                <Badge variant={p.status === "active" ? "default" : "secondary"}>{p.status}</Badge>
                <div className="seller-row-actions">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Edit ${p.title}`}
                    title="Edit"
                    onClick={() => setEditing(p)}
                  >
                    <Pencil size={15} />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Delete ${p.title}`}
                    title="Delete"
                    onClick={() => setDeleting(p)}
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
        <DialogContent className="seller-dialog">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit product" : "Add a product"}</DialogTitle>
            <DialogDescription>
              {editing ? editing.title : `New product for ${store.name}`}
            </DialogDescription>
          </DialogHeader>
          {editing !== undefined && (
            <ProductForm
              key={editing?.id ?? "new"}
              product={editing ?? undefined}
              categories={categories}
              busy={save.isPending}
              progress={
                photoProgress && photoProgress.done < photoProgress.total
                  ? `Preparing photo ${photoProgress.done + 1} of ${photoProgress.total}…`
                  : null
              }
              onCancel={() => setEditing(undefined)}
              onSubmit={(values, images) =>
                save.mutateAsync([store.id, values, images, editing ?? undefined, setPhotoProgress])
              }
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this product?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleting?.title}” and its images will be removed permanently. To hide it
              temporarily, set it to draft instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) remove.mutate(deleting);
              }}
            >
              {remove.isPending ? "Deleting…" : "Delete product"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
