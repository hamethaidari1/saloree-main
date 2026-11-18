/**
 * Where the shopping cart is saved. localStorage is per-origin, so on
 * production the cart lives in a cookie scoped to `.<root domain>` and is
 * shared by saloree.com and every <store>.saloree.com. Only product ids,
 * quantities and the chosen color/size are stored — prices and names always
 * come from the database, and `place_order` re-validates everything
 * (including that the color and size are the product's own) on the server.
 */
import { hostConfig, normalizeHost } from "./host";

export interface StoredCartItem {
  productId: string;
  quantity: number;
  color?: string | null;
  size?: string | null;
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
/** Longer than any color (30) or size (20) the database accepts. */
const MAX_OPTION = 40;

const option = (v: unknown) =>
  typeof v === "string" && v.length > 0 && v.length <= MAX_OPTION ? v : null;

/**
 * "id:qty|id:qty:color:size", URI-encoded — compact and free of cookie-unsafe
 * characters. A line without color or size keeps the short "id:qty" form; the
 * color and size are each encoded first, so ":" and "|" in them are safe.
 */
export function encodeCart(items: StoredCartItem[]) {
  return encodeURIComponent(
    items
      .filter((i) => ID_RE.test(i.productId) && Number.isInteger(i.quantity) && i.quantity > 0)
      .map((i) => {
        const color = option(i.color);
        const size = option(i.size);
        const base = `${i.productId}:${i.quantity}`;
        return color || size
          ? `${base}:${encodeURIComponent(color ?? "")}:${encodeURIComponent(size ?? "")}`
          : base;
      })
      .join("|"),
  );
}

const decodeOption = (v: string | undefined) => {
  if (!v) return null;
  try {
    return option(decodeURIComponent(v));
  } catch {
    return null;
  }
};

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
    const fields = part.split(":");
    // "id:qty" or "id:qty:color:size"; anything else is not ours.
    if (fields.length !== 2 && fields.length !== 4) continue;
    const [id, qty, color, size] = fields;
    const quantity = Number(qty);
    if (!id || !ID_RE.test(id)) continue;
    if (!Number.isInteger(quantity) || quantity < 1) continue;
    const c = decodeOption(color);
    const s = decodeOption(size);
    out.push({ productId: id, quantity, ...(c ? { color: c } : {}), ...(s ? { size: s } : {}) });
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
      const { productId, quantity, color, size } = i as Record<string, unknown>;
      const c = option(color);
      const s = option(size);
      return typeof productId === "string" &&
        typeof quantity === "number" &&
        Number.isInteger(quantity) &&
        quantity > 0
        ? [{ productId, quantity, ...(c ? { color: c } : {}), ...(s ? { size: s } : {}) }]
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
          JSON.stringify(
            items.map(({ productId, quantity, color, size }) => ({
              productId,
              quantity,
              ...(option(color) ? { color } : {}),
              ...(option(size) ? { size } : {}),
            })),
          ),
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
