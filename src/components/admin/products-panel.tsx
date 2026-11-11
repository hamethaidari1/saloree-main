import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ImageOff, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelState } from "@/components/seller/panel-state";
import { adminService, type AdminProduct } from "@/services/admin";
import { money } from "@/services/catalog";
import { ConfirmDialog, type ConfirmRequest } from "./confirm-dialog";
import { adminKeys } from "./keys";
import { matches, useAdminAction } from "./use-admin-action";

export function ProductsPanel() {
  const products = useQuery({ queryKey: adminKeys.products, queryFn: adminService.listProducts });
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const setStatus = useAdminAction(
    (v: { product: AdminProduct; status: "active" | "draft" }) =>
      adminService.setProductStatus(v.product.id, v.status),
    { success: (v) => `“${v.product.title}” set to ${v.status}` },
  );
  const remove = useAdminAction((p: AdminProduct) => adminService.deleteProduct(p.id), {
    success: (p) => `“${p.title}” deleted`,
  });

  return (
    <section aria-labelledby="admin-products-heading">
      <div className="seller-panel-head">
        <div>
          <h2 id="admin-products-heading">Products</h2>
          <p>Every product across all stores.</p>
        </div>
        <Input
          type="search"
          className="admin-search"
          placeholder="Search title or store"
          aria-label="Search products"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <PanelState
        query={products}
        errorText="Products could not be loaded."
        empty={{
          title: "No products yet",
          description: "Products appear here when sellers add them.",
        }}
      >
        {(all) => {
          const list = all.filter((p) => matches(search, p.title, p.slug, p.stores?.name));
          if (!list.length) return <p className="seller-hint">No products match “{search}”.</p>;
          return (
            <ul className="seller-list">
              {list.map((p) => {
                const active = p.status === "active";
                const busy =
                  (setStatus.isPending && setStatus.variables?.product.id === p.id) ||
                  (remove.isPending && remove.variables?.id === p.id);
                return (
                  <li key={p.id} className="seller-row">
                    <div className="seller-thumb">
                      {p.featured_image ? (
                        <img src={p.featured_image} alt="" loading="lazy" />
                      ) : (
                        <ImageOff aria-hidden />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="seller-row-title">
                        {active ? (
                          <Link to="/product/$id" params={{ id: p.id }} className="hover:underline">
                            {p.title}
                          </Link>
                        ) : (
                          p.title
                        )}
                      </h3>
                      <p className="seller-row-meta">
                        {p.stores?.name ?? "Unknown store"}
                        <span aria-hidden>·</span>
                        {money(Number(p.price))}
                        <span aria-hidden>·</span>
                        {p.stock} in stock
                      </p>
                    </div>
                    <Badge variant={active ? "default" : "secondary"}>{p.status}</Badge>
                    <div className="seller-row-actions gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          setStatus.mutate({ product: p, status: active ? "draft" : "active" })
                        }
                      >
                        {active ? "Set draft" : "Set active"}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${p.title}`}
                        title="Delete"
                        disabled={busy}
                        onClick={() =>
                          setConfirm({
                            title: "Delete this product?",
                            description: `“${p.title}” from ${p.stores?.name ?? "its store"} will be removed permanently. Setting it to draft hides it without deleting.`,
                            confirmLabel: "Delete product",
                            destructive: true,
                            run: () => remove.mutateAsync(p),
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
          );
        }}
      </PanelState>
      <ConfirmDialog request={confirm} busy={remove.isPending} onClose={() => setConfirm(null)} />
    </section>
  );
}
