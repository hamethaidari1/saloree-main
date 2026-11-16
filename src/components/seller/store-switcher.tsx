import { Link } from "@tanstack/react-router";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { StoreRow } from "@/data/db";
import { canCreateStore } from "@/services/store-limits";
import { useSeller } from "./seller-context";
import { usePendingByStore, useStoreLimit } from "./use-create-store";

function StoreMark({
  store,
  size = 28,
}: {
  store: Pick<StoreRow, "name" | "logo_url">;
  size?: number;
}) {
  return store.logo_url ? (
    <img src={store.logo_url} alt="" width={size} height={size} className="store-switch-logo" />
  ) : (
    <span className="seller-store-chip" aria-hidden style={{ inlineSize: size, blockSize: size }}>
      {store.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * The active store at the top of the seller sidebar, and a menu of ALL my
 * stores (only mine: the list comes from getMyStores, filtered by owner).
 * A dot marks another store with new orders waiting.
 */
export function StoreSwitcher({
  compact,
  onNavigate,
}: {
  compact: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const { store, stores, setStoreId, user } = useSeller();
  const limit = useStoreLimit(user.id);
  const pending = usePendingByStore(stores);
  const waitingElsewhere = stores.filter(
    (s) => s.id !== store.id && (pending.data?.[s.id] ?? 0) > 0,
  );
  const canCreate = canCreateStore(limit.data);
  const limitReason =
    limit.isSuccess && !canCreate
      ? `You have reached your store limit (${limit.data.used} of ${limit.data.max_stores}). Contact Saloree support to open more.`
      : limit.isError
        ? "Your store limit could not be loaded."
        : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="store-switch"
        data-compact={compact || undefined}
        aria-label={`Store: ${store.name} (${store.status}). Switch store${waitingElsewhere.length ? ", another store has new orders" : ""}`}
        data-testid="store-switcher"
      >
        <span className="store-switch-mark">
          <StoreMark store={store} />
          {waitingElsewhere.length > 0 && (
            <span className="store-switch-dot" data-testid="other-store-dot" aria-hidden />
          )}
        </span>
        {!compact && (
          <>
            <span className="store-switch-text">
              <span className="store-switch-name">{store.name}</span>
              <Badge variant={store.status === "published" ? "default" : "secondary"}>
                {store.status}
              </Badge>
            </span>
            <ChevronsUpDown size={16} aria-hidden className="store-switch-chevron" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="store-switch-menu">
        <DropdownMenuLabel>Your stores</DropdownMenuLabel>
        {stores.map((s) => {
          const active = s.id === store.id;
          const waiting = !active && (pending.data?.[s.id] ?? 0) > 0;
          return (
            <DropdownMenuItem
              key={s.id}
              className="store-switch-item"
              data-testid="store-switch-item"
              aria-current={active ? "true" : undefined}
              onSelect={() => {
                if (!active) setStoreId(s.id); // the page stays the same type
                onNavigate?.();
              }}
            >
              <StoreMark store={s} size={22} />
              <span className="store-switch-name">{s.name}</span>
              {waiting && (
                <span className="store-switch-dot" aria-label="new orders waiting" role="img" />
              )}
              <Badge variant={s.status === "published" ? "default" : "secondary"}>{s.status}</Badge>
              {active && (
                <span className="store-switch-active">
                  <Check size={14} aria-hidden />
                  Active
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        {canCreate ? (
          <DropdownMenuItem asChild>
            <Link
              to="/seller/stores/new"
              onClick={onNavigate}
              className="store-switch-create"
              data-testid="create-another-store"
            >
              <Plus size={16} aria-hidden />
              Create another store
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled
            className="store-switch-create"
            data-testid="create-another-store"
            aria-describedby="store-limit-reason"
          >
            <Plus size={16} aria-hidden />
            Create another store
          </DropdownMenuItem>
        )}
        {limitReason && (
          <p id="store-limit-reason" className="store-switch-note" data-testid="store-limit-reason">
            {limitReason}
          </p>
        )}
        {limit.isSuccess && (
          <p className="store-switch-note" data-testid="store-count">
            Stores: {limit.data.used} of {limit.data.max_stores}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
