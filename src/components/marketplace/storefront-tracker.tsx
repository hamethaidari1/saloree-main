import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import type { Store } from "@/data/catalog";
import { useAuth } from "@/lib/auth";
import { isCountedViewer, sendTrack, trackedStoreSlug } from "@/lib/storefront-tracking";
import { catalogQuery } from "@/services/catalog";

/**
 * Counts one page view per storefront navigation (see trackedStoreSlug).
 * Runs in the browser only (an effect), after the page has loaded, and never
 * blocks rendering. Waits until sign-in is known, so the store's owner and
 * staff are never counted. Renders nothing.
 */
export function StorefrontTracker() {
  const { user, roles, ready } = useAuth();
  const queryClient = useQueryClient();
  // "pathname\nslug" once the page has loaded and is a storefront view, else null.
  const view = useRouterState({
    select: (s) => {
      if (s.status !== "idle" || s.matches.some((m) => m.status !== "success")) return null;
      const data = (id: string) => s.matches.find((m) => m.routeId === id)?.loaderData;
      const root = data("__root__") as { store?: Store | null } | undefined;
      const product = data("/product/$id") as { storeSlug?: string } | undefined;
      const slug = trackedStoreSlug(s.location.pathname, {
        siteStoreSlug: root?.store?.slug ?? null,
        productStoreSlug: product?.storeSlug ?? null,
      });
      return slug ? `${s.location.pathname}\n${slug}` : null;
    },
  });
  const lastPath = useRef<string | null>(null);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!view || !ready) return;
    const [pathname = "", slug = ""] = view.split("\n");
    if (lastPath.current === pathname) return; // once per navigation
    lastPath.current = pathname;
    const store = queryClient
      .getQueryData(catalogQuery.queryKey)
      ?.stores.find((s) => s.slug === slug);
    if (!store?.id || !isCountedViewer({ userId, roles }, store)) return;
    sendTrack(store.id);
  }, [view, ready, userId, roles, queryClient]);

  return null;
}
