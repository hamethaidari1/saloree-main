/**
 * Where the shopping cart is saved. localStorage is per-origin, so on
 * production the cart lives in a cookie scoped to `.<root domain>` and is
 * shared by saloree.com and every <store>.saloree.com. Only product ids and
 * quantities are stored — prices and names always come from the database,
 * and `place_order` re-validates everything on the server.
 */
import { hostConfig, normalizeHost } from "./host";

export interface StoredCartItem {
  productId: string;
  quantity: number;
}
export interface CartStorage {
  /** Raw saved items; the cart validates them against the live catalog. */
  load(): StoredCartItem[];
  save(items: StoredCartItem[]): void;
  readonly kind: "cookie" | "local";
}

export const CART_KEY = "saloree-cart-v1";
export const CART_COOKIE = "saloree_cart";
export const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
/** Browsers allow ~4096 bytes per cookie including name and attributes. */
export const CART_COOKIE_MAX_BYTES = 3800;

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;

/** "id:qty|id:qty", URI-encoded — compact and free of cookie-unsafe characters. */
export function encodeCart(items: StoredCartItem[]) {
  return encodeURIComponent(
    items
      .filter((i) => ID_RE.test(i.productId) && Number.isInteger(i.quantity) && i.quantity > 0)
      .map((i) => `${i.productId}:${i.quantity}`)
      .join("|"),
  );
}

export function decodeCart(value: string | null | undefined): StoredCartItem[] {
  if (!value) return [];
  let raw: string;
  try {
    raw = decodeURIComponent(value);
  } catch {
    return [];
  }
  const out: StoredCartItem[] = [];
  for (const part of raw.split("|")) {
    const [id, qty, extra] = part.split(":");
    const quantity = Number(qty);
    if (extra !== undefined || !id || !ID_RE.test(id)) continue;
    if (!Number.isInteger(quantity) || quantity < 1) continue;
    out.push({ productId: id, quantity });
  }
  return out;
}

function parseLocal(json: string | null): StoredCartItem[] {
  if (!json) return [];
  try {
    const data: unknown = JSON.parse(json);
    if (!Array.isArray(data)) return [];
    return data.flatMap((i: unknown) => {
      if (typeof i !== "object" || i === null) return [];
      const { productId, quantity } = i as Record<string, unknown>;
      return typeof productId === "string" &&
        typeof quantity === "number" &&
        Number.isInteger(quantity) &&
        quantity > 0
        ? [{ productId, quantity }]
        : [];
    });
  } catch {
    return [];
  }
}

type CookieJar = { cookie: string };
type KeyValue = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function createLocalCartStorage(storage: KeyValue | null): CartStorage {
  return {
    kind: "local",
    load: () => {
      try {
        return parseLocal(storage?.getItem(CART_KEY) ?? null);
      } catch {
        return [];
      }
    },
    save: (items) => {
      try {
        storage?.setItem(
          CART_KEY,
          JSON.stringify(items.map(({ productId, quantity }) => ({ productId, quantity }))),
        );
      } catch {
        /* Shopping still works without storage. */
      }
    },
  };
}

export function createCookieCartStorage(opts: {
  jar: CookieJar;
  domain: string;
  secure: boolean;
  fallback: CartStorage;
}): CartStorage {
  const { jar, domain, secure, fallback } = opts;
  const attrs = `Domain=.${domain}; Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
  const read = () => {
    const hit = jar.cookie.split("; ").find((c) => c.startsWith(`${CART_COOKIE}=`));
    return hit === undefined ? null : hit.slice(CART_COOKIE.length + 1);
  };
  return {
    kind: "cookie",
    load: () => {
      const value = read();
      // No cookie yet: pick up a cart saved by an older version in localStorage.
      return value === null ? fallback.load() : decodeCart(value);
    },
    save: (items) => {
      const value = encodeCart(items);
      const cookie = `${CART_COOKIE}=${value}; Max-Age=${CART_COOKIE_MAX_AGE}; ${attrs}`;
      if (cookie.length > CART_COOKIE_MAX_BYTES) {
        // Too big for a cookie: keep it in this site's storage and drop the
        // stale shared copy rather than silently losing items.
        jar.cookie = `${CART_COOKIE}=; Max-Age=0; ${attrs}`;
        fallback.save(items);
        return;
      }
      jar.cookie = cookie;
      if (read() !== value) fallback.save(items); // cookies blocked
    },
  };
}

/**
 * Production on the configured domain (or one of its store subdomains):
 * shared cookie. Development, previews and other hosts: localStorage.
 */
export function defaultCartStorage(): CartStorage {
  const local = createLocalCartStorage(
    (() => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    })(),
  );
  const { rootDomain, dev } = hostConfig();
  const host = normalizeHost(window.location.host);
  const onDomain = !!rootDomain && (host === rootDomain || host.endsWith(`.${rootDomain}`));
  if (dev || !onDomain) return local;
  return createCookieCartStorage({
    jar: document,
    domain: rootDomain,
    secure: window.location.protocol === "https:",
    fallback: local,
  });
}
