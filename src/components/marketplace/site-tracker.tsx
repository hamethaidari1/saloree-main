import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import type { Store } from "@/data/catalog";
import { useAuth } from "@/lib/auth";
import { hostConfig } from "@/lib/host";
import { buildPageview, isCountedSiteViewer, sendPageview } from "@/lib/site-tracking";
import { trackedStoreSlug } from "@/lib/storefront-tracking";
import { catalogQuery } from "@/services/catalog";

// The first page after a full page load is the "entry" (only it carries the
// referrer and utm_* tags). Module state: resets on a real reload, nowhere stored.
let entrySent = false;
/** For tests. */
export const resetSiteEntry = () => {
  entrySent = false;
};

/**
 * Counts one page view on the first load and on every client-side route
 * change (admin → Visitors). Browser only, after the page has loaded; waits
 * until sign-in is known so staff are never counted. Renders nothing.
 */
export function SiteTracker() {
  const { roles, ready } = useAuth();
  const queryClient = useQueryClient();
  // "pathname\nstoreSlug" once the page has loaded, else null.
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
      return `${s.location.pathname}\n${slug ?? ""}`;
    },
  });
  const lastPath = useRef<string | null>(null);

  useEffect(() => {
    if (!view || !ready) return;
    const [pathname = "/", slug = ""] = view.split("\n");
    if (lastPath.current === pathname) return; // once per navigation
    lastPath.current = pathname;
    // Only the very first view after a load is the entry, even when it isn't counted.
    const isEntry = !entrySent;
    entrySent = true;
    if (!isCountedSiteViewer(roles)) return;
    const storeId = slug
      ? (queryClient.getQueryData(catalogQuery.queryKey)?.stores.find((s) => s.slug === slug)?.id ??
        null)
      : null;
    const body = buildPageview({
      pathname,
      search: window.location.search,
      referrer: document.referrer,
      host: window.location.hostname,
      rootDomain: hostConfig().rootDomain,
      isEntry,
      storeId,
    });
    if (body) sendPageview(body);
  }, [view, ready, roles, queryClient]);

  return null;
}
