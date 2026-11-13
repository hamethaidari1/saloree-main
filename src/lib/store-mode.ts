import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie, getRequestHost } from "@tanstack/react-start/server";
import { useRouteContext } from "@tanstack/react-router";
import type { Store } from "@/data/catalog";
import {
  DEV_STORE_COOKIE,
  DEV_STORE_SESSION_KEY,
  getStoreSlugFromHost,
  hostConfig,
  resolveDevStore,
} from "./host";

function readBrowserCookie(name: string) {
  const match = document.cookie.split("; ").find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}
function readSession() {
  try {
    return sessionStorage.getItem(DEV_STORE_SESSION_KEY);
  } catch {
    return null;
  }
}

/** Host + saved dev override, read on whichever side is running. */
const readRequestContext = createIsomorphicFn()
  .server(() => ({
    host: getRequestHost({ xForwardedHost: true }),
    session: null as string | null,
    cookie: import.meta.env.DEV ? (getCookie(DEV_STORE_COOKIE) ?? null) : null,
  }))
  .client(() => ({
    host: window.location.host,
    session: import.meta.env.DEV ? readSession() : null,
    cookie: import.meta.env.DEV ? readBrowserCookie(DEV_STORE_COOKIE) : null,
  }));

/**
 * Saves (or clears) the dev override in sessionStorage, mirrored to a session
 * cookie so a full page reload renders the same store on the server.
 */
export function persistDevStore(persist: "set" | "clear" | null, slug: string | null) {
  if (!import.meta.env.DEV || typeof window === "undefined" || !persist) return;
  try {
    if (persist === "set" && slug) sessionStorage.setItem(DEV_STORE_SESSION_KEY, slug);
    else sessionStorage.removeItem(DEV_STORE_SESSION_KEY);
  } catch {
    /* storage unavailable */
  }
  document.cookie =
    persist === "set" && slug
      ? `${DEV_STORE_COOKIE}=${encodeURIComponent(slug)}; Path=/; SameSite=Lax`
      : `${DEV_STORE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** The store this request is for, or null on the main marketplace. */
export function resolveStoreSlug(search: Record<string, unknown>): string | null {
  const ctx = readRequestContext();
  const fromHost = getStoreSlugFromHost(ctx.host, hostConfig().rootDomain);
  if (fromHost) return fromHost;
  if (!import.meta.env.DEV) return null;
  const dev = resolveDevStore({ param: search["store"], session: ctx.session, cookie: ctx.cookie });
  persistDevStore(dev.persist, dev.slug);
  return dev.slug;
}

/** Store slug from the root route context (null on the marketplace). */
export function useStoreSlug(): string | null {
  return useRouteContext({
    from: "__root__",
    select: (c) => ("storeSlug" in c ? (c.storeSlug as string | null) : null),
  });
}

/** The current store from the root loader, for route `head()` functions. */
export function storeFromMatches(matches: readonly { routeId: string; loaderData?: unknown }[]) {
  const root = matches.find((m) => m.routeId === "__root__");
  return (root?.loaderData as { store?: Store | null } | undefined)?.store ?? null;
}
