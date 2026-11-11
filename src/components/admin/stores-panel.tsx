import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelState } from "@/components/seller/panel-state";
import { adminService, type AdminStore } from "@/services/admin";
import { ConfirmDialog, type ConfirmRequest } from "./confirm-dialog";
import { adminKeys } from "./keys";
import { matches, useAdminAction } from "./use-admin-action";

export function StoresPanel() {
  const stores = useQuery({ queryKey: adminKeys.stores, queryFn: adminService.listStores });
  const [search, setSearch] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const setStatus = useAdminAction(
    (v: { store: AdminStore; status: "published" | "draft" }) =>
      adminService.setStoreStatus(v.store.id, v.status),
    {
      success: (v) => `${v.store.name} is now ${v.status === "published" ? "live" : "a draft"}`,
    },
  );

  return (
    <section aria-labelledby="admin-stores-heading">
      <div className="seller-panel-head">
        <div>
          <h2 id="admin-stores-heading">Stores</h2>
          <p>Publish stores to make them visible to shoppers.</p>
        </div>
        <Input
          type="search"
          className="admin-search"
          placeholder="Search name, slug or owner"
          aria-label="Search stores"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <PanelState
        query={stores}
        errorText="Stores could not be loaded."
        empty={{
          title: "No stores yet",
          description: "Stores appear here when sellers create them.",
        }}
      >
        {(all) => {
          const list = all.filter((s) => matches(search, s.name, s.slug, s.ownerEmail));
          if (!list.length) return <p className="seller-hint">No stores match “{search}”.</p>;
          return (
            <ul className="seller-list">
              {list.map((s) => {
                const published = s.status === "published";
                const busy = setStatus.isPending && setStatus.variables?.store.id === s.id;
                return (
                  <li key={s.id} className="seller-row">
                    <div className="min-w-0 flex-1">
                      <h3 className="seller-row-title">{s.name}</h3>
                      <p className="seller-row-meta">
                        {s.ownerEmail ?? "Unknown owner"}
                        <span aria-hidden>·</span>
                        {s.productCount} product{s.productCount === 1 ? "" : "s"}
                        <span aria-hidden>·</span>/store/{s.slug}
                      </p>
                    </div>
                    <Badge variant={published ? "default" : "secondary"}>{s.status}</Badge>
                    <div className="seller-row-actions gap-2">
                      {published ? (
                        <>
                          <Button asChild size="sm" variant="ghost">
                            <Link to="/store/$slug" params={{ slug: s.slug }}>
                              View
                              <ExternalLink />
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              setConfirm({
                                title: `Unpublish ${s.name}?`,
                                description:
                                  "The store and its products disappear from the marketplace until it is published again.",
                                confirmLabel: "Unpublish",
                                destructive: true,
                                run: () => setStatus.mutateAsync({ store: s, status: "draft" }),
                              })
                            }
                          >
                            Unpublish
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() => setStatus.mutate({ store: s, status: "published" })}
                        >
                          {busy ? "Publishing…" : "Publish"}
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
      <ConfirmDialog
        request={confirm}
        busy={setStatus.isPending}
        onClose={() => setConfirm(null)}
      />
    </section>
  );
}
