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
import { PRODUCT_STATUSES } from "@/services/seller";

type ProductStatus = (typeof PRODUCT_STATUSES)[number];
import { ConfirmDialog, type ConfirmRequest } from "./confirm-dialog";
import { adminKeys } from "./keys";
import { matches, useAdminAction } from "./use-admin-action";

/**
 * Every product across all stores. Content staff may change ONLY the status
 * (the database enforces it); deleting is for admins (`canDelete`).
 */
export function ProductsPanel({ canDelete = false }: { canDelete?: boolean }) {
  const products = useQuery({ queryKey: adminKeys.products, queryFn: adminService.listProducts });
  const [search, setSearch] = useState("");
  const [store, setStore] = useState("");
  const [status, setStatusFilter] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const setStatus = useAdminAction(
    (v: { product: AdminProduct; status: ProductStatus }) =>
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
          <p>Every product across all stores. Only the status can be changed here.</p>
        </div>
        <div className="staff-filters">
          <select
            aria-label="Filter by store"
            className="staff-select"
            value={store}
            onChange={(e) => setStore(e.target.value)}
          >
            <option value="">All stores</option>
            {[
              ...new Map(
                (products.data ?? []).map((p) => [p.store_id, p.stores?.name ?? p.store_id]),
              ),
            ]
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
          </select>
          <select
            aria-label="Filter by status"
            className="staff-select"
            value={status}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {PRODUCT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <Input
            type="search"
            className="admin-search"
            placeholder="Search title or store"
            aria-label="Search products"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
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
          const list = all.filter(
            (p) =>
              (!store || p.store_id === store) &&
              (!status || p.status === status) &&
              matches(search, p.title, p.slug, p.stores?.name),
          );
          if (!list.length) return <p className="seller-hint">No products match these filters.</p>;
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
                      <select
                        aria-label={`Status of ${p.title}`}
                        className="staff-select"
                        value={p.status ?? "draft"}
                        disabled={busy}
                        onChange={(e) =>
                          setStatus.mutate({ product: p, status: e.target.value as ProductStatus })
                        }
                      >
                        {PRODUCT_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      {canDelete && (
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
                      )}
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
