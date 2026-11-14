import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PanelState } from "@/components/seller/panel-state";
import { adminService, type AdminStore } from "@/services/admin";
import { money } from "@/services/catalog";
import { friendlyError } from "@/services/errors";
import { marketplaceService } from "@/services/marketplace";
import { STATUS_LABEL, type VerificationStatus } from "@/lib/seller-verification";
import {
  errorText,
  sellerVerificationService,
  verificationKeys,
} from "@/services/seller-verification";
import { ConfirmDialog, type ConfirmRequest } from "./confirm-dialog";
import { adminKeys } from "./keys";
import { matches, useAdminAction } from "./use-admin-action";

type StatusFilter = "" | "draft" | "published";

/** The owner's verification next to each store: a store can be published only when approved. */
function OwnerVerification({ status }: { status: VerificationStatus | null | undefined }) {
  if (status === undefined) return null; // still loading, or couldn't be loaded (shown above)
  const verified = status === "approved";
  return (
    <Badge
      variant={verified ? "default" : "outline"}
      data-testid="owner-verification"
      title="Owner's seller verification"
    >
      {verified
        ? "Seller verified"
        : `Seller ${status ? STATUS_LABEL[status].toLowerCase() : "not verified yet"}`}
    </Badge>
  );
}

/** Store details + its products, in a side drawer. */
function StoreDrawer({ store, onClose }: { store: AdminStore | null; onClose: () => void }) {
  const products = useQuery({
    queryKey: [...adminKeys.stores, "products", store?.id ?? ""],
    queryFn: () => marketplaceService.storeProducts(store!.id),
    enabled: !!store,
  });
  return (
    <Sheet open={!!store} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="staff-drawer overflow-y-auto">
        {store && (
          <>
            <SheetHeader>
              <SheetTitle>{store.name}</SheetTitle>
              <SheetDescription>/store/{store.slug}</SheetDescription>
            </SheetHeader>
            <dl className="staff-facts">
              <dt>Status</dt>
              <dd>{store.status}</dd>
              <dt>Owner</dt>
              <dd>
                {store.ownerName ?? "—"}
                {store.ownerEmail && (
                  <bdi className="block text-muted-foreground">{store.ownerEmail}</bdi>
                )}
              </dd>
              <dt>Category</dt>
              <dd>{store.category || "—"}</dd>
              <dt>Location</dt>
              <dd>{store.location || "—"}</dd>
              <dt>Created</dt>
              <dd>{store.created_at ? new Date(store.created_at).toLocaleString() : "—"}</dd>
              <dt>Description</dt>
              <dd dir="auto">{store.description || "—"}</dd>
            </dl>
            <h3 className="staff-subhead">Products ({store.productCount})</h3>
            {products.isPending ? (
              <div className="seller-skeleton" aria-busy="true" aria-label="Loading products">
                <div />
              </div>
            ) : products.isError ? (
              <p role="alert" className="seller-error">
                {friendlyError(products.error)}
              </p>
            ) : !products.data.length ? (
              <p className="seller-hint">This store has no products yet.</p>
            ) : (
              <ul className="seller-list">
                {products.data.map((p) => (
                  <li key={p.id} className="seller-row">
                    <div className="seller-thumb">
                      {p.featured_image ? (
                        <img src={p.featured_image} alt="" loading="lazy" />
                      ) : (
                        <ImageOff aria-hidden />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="seller-row-title" dir="auto">
                        {p.title}
                      </p>
                      <p className="seller-row-meta">
                        {money(Number(p.price))}
                        <span aria-hidden>·</span>
                        {p.stock ?? 0} in stock
                      </p>
                    </div>
                    <Badge variant={p.status === "active" ? "default" : "secondary"}>
                      {p.status}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Stores across the marketplace. `myUserId` + `canChangeOwn=false` hides the
 * approve/unpublish buttons on the signed-in staff member's own stores (the
 * database refuses those changes too).
 */
export function StoresPanel({
  myUserId = null,
  canChangeOwn = true,
}: {
  myUserId?: string | null;
  canChangeOwn?: boolean;
}) {
  const stores = useQuery({ queryKey: adminKeys.stores, queryFn: adminService.listStores });
  const ownerIds = [...new Set((stores.data ?? []).map((s) => s.owner_id))].sort();
  const verification = useQuery({
    queryKey: verificationKeys.statuses(ownerIds),
    queryFn: () => sellerVerificationService.statusesFor(ownerIds),
    enabled: ownerIds.length > 0,
    retry: false,
  });
  const ownerStatus = (ownerId: string): VerificationStatus | null | undefined =>
    verification.isSuccess ? (verification.data.get(ownerId) ?? null) : undefined;
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("");
  const [open, setOpen] = useState<AdminStore | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const change = useAdminAction(
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
          <p>
            Approve new stores and unpublish stores that break the rules. A store can be published
            only when its owner's seller verification is approved.
          </p>
        </div>
        <div className="staff-filters">
          <select
            aria-label="Filter by status"
            className="staff-select"
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
          >
            <option value="">All statuses</option>
            <option value="draft">Waiting for approval (draft)</option>
            <option value="published">Published</option>
          </select>
          <Input
            type="search"
            className="admin-search"
            placeholder="Search name, slug or owner"
            aria-label="Search stores"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      {verification.isError && (
        <p role="alert" className="seller-error mb-3">
          Owners' verification status could not be loaded: {errorText(verification.error)}
        </p>
      )}
      <PanelState
        query={stores}
        errorText="Stores could not be loaded."
        empty={{
          title: "No stores yet",
          description: "Stores appear here when sellers create them.",
        }}
      >
        {(all) => {
          const list = all.filter(
            (s) =>
              (!status || s.status === status) &&
              matches(search, s.name, s.slug, s.ownerEmail, s.ownerName),
          );
          if (!list.length) return <p className="seller-hint">No stores match these filters.</p>;
          return (
            <ul className="seller-list">
              {list.map((s) => {
                const published = s.status === "published";
                const own = !!myUserId && s.owner_id === myUserId;
                const busy = change.isPending && change.variables?.store.id === s.id;
                const refused =
                  change.isError &&
                  change.variables?.store.id === s.id &&
                  change.variables.status === "published";
                return (
                  <li key={s.id} className="seller-row">
                    <div className="min-w-0 flex-1">
                      <h3 className="seller-row-title">
                        <button type="button" className="staff-link" onClick={() => setOpen(s)}>
                          {s.name}
                        </button>
                        {own && <span className="staff-own"> (your store)</span>}
                      </h3>
                      <p className="seller-row-meta">
                        {s.ownerName ?? "Unknown owner"}
                        {s.ownerEmail && (
                          <>
                            <span aria-hidden>·</span>
                            <bdi>{s.ownerEmail}</bdi>
                          </>
                        )}
                        <span aria-hidden>·</span>
                        {s.productCount} product{s.productCount === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Badge variant={published ? "default" : "secondary"}>{s.status}</Badge>
                    <OwnerVerification status={ownerStatus(s.owner_id)} />
                    <div className="seller-row-actions gap-2">
                      {published && (
                        <Button asChild size="sm" variant="ghost">
                          <Link to="/store/$slug" params={{ slug: s.slug }}>
                            View
                            <ExternalLink />
                          </Link>
                        </Button>
                      )}
                      {own && !canChangeOwn ? null : published ? (
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
                              run: () => change.mutateAsync({ store: s, status: "draft" }),
                            })
                          }
                        >
                          Unpublish
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            setConfirm({
                              title: `Approve and publish ${s.name}?`,
                              description:
                                "The store and its active products become visible to shoppers.",
                              confirmLabel: "Approve (publish)",
                              run: () => change.mutateAsync({ store: s, status: "published" }),
                            })
                          }
                        >
                          {busy ? "Publishing…" : "Approve (publish)"}
                        </Button>
                      )}
                    </div>
                    {refused && (
                      // The database's own words, e.g. "The seller must be verified before
                      // the store can be published" (the toast may shorten permission errors).
                      <p
                        role="alert"
                        className="seller-error basis-full"
                        data-testid="publish-error"
                      >
                        {errorText(change.error)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          );
        }}
      </PanelState>
      <StoreDrawer store={open} onClose={() => setOpen(null)} />
      <ConfirmDialog request={confirm} busy={change.isPending} onClose={() => setConfirm(null)} />
    </section>
  );
}
