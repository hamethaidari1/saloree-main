import { describe, expect, it } from "vitest";
import {
  CART_COOKIE,
  CART_COOKIE_MAX_BYTES,
  CART_KEY,
  createCookieCartStorage,
  createLocalCartStorage,
  decodeCart,
  encodeCart,
} from "@/lib/cartStorage";

/** A cookie jar that behaves like document.cookie for one host. */
function fakeJar(opts: { blocked?: boolean } = {}) {
  const store = new Map<string, string>();
  const written: string[] = [];
  return {
    written,
    get cookie() {
      return [...store].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(raw: string) {
      written.push(raw);
      if (opts.blocked) return;
      const [pair, ...attrs] = raw.split("; ");
      const [name, value = ""] = (pair ?? "").split(/=(.*)/s);
      if (!name) return;
      if (attrs.some((a) => a === "Max-Age=0")) store.delete(name);
      else store.set(name, value);
    },
  };
}
function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    raw: m,
  };
}
const P1 = "074fe87b-ca8f-41d9-85f8-35f63e138062";
const P2 = "ae31c344-3d17-4650-964a-18d269a820a8";

describe("cart encoding", () => {
  it("round-trips ids and quantities only", () => {
    const items = [
      { productId: P1, quantity: 2 },
      { productId: P2, quantity: 1 },
    ];
    expect(decodeCart(encodeCart(items))).toEqual(items);
  });
  it("never contains prices, names or cookie-unsafe characters", () => {
    const v = encodeCart([{ productId: P1, quantity: 3, price: 99, title: "x; y" } as never]);
    expect(v).not.toMatch(/[;,\s"]/);
    expect(decodeURIComponent(v)).toBe(`${P1}:3`);
  });
  it("drops malformed or tampered entries", () => {
    expect(
      decodeCart(encodeURIComponent(`${P1}:2|bad id:1|${P2}:0|${P2}:1.5|${P2}:-3|x:1:2`)),
    ).toEqual([{ productId: P1, quantity: 2 }]);
    expect(decodeCart("%E0%A4%A")).toEqual([]);
    expect(decodeCart(null)).toEqual([]);
  });
});

describe("cookie storage (production, shared across subdomains)", () => {
  it("writes one cookie scoped to the root domain with safe attributes", () => {
    const jar = fakeJar();
    const s = createCookieCartStorage({
      jar,
      domain: "saloree.com",
      secure: true,
      fallback: createLocalCartStorage(fakeStorage()),
    });
    s.save([{ productId: P1, quantity: 2 }]);
    const raw = jar.written.at(-1) ?? "";
    expect(raw.startsWith(`${CART_COOKIE}=`)).toBe(true);
    expect(raw).toContain("Domain=.saloree.com");
    expect(raw).toContain("Path=/");
    expect(raw).toContain("SameSite=Lax");
    expect(raw).toContain("Secure");
    expect(raw).toContain(`Max-Age=${60 * 60 * 24 * 30}`);
  });

  it("a store subdomain and the main site see the same cart", () => {
    // Both hosts share the browser's .saloree.com cookie jar.
    const shared = fakeJar();
    const opts = { jar: shared, domain: "saloree.com", secure: true };
    const onStore = createCookieCartStorage({
      ...opts,
      fallback: createLocalCartStorage(fakeStorage()),
    });
    const onMain = createCookieCartStorage({
      ...opts,
      fallback: createLocalCartStorage(fakeStorage()),
    });
    onStore.save([{ productId: P1, quantity: 2 }]);
    expect(onMain.load()).toEqual([{ productId: P1, quantity: 2 }]);
    onMain.save([]);
    expect(onStore.load()).toEqual([]);
  });

  it("reads an older localStorage cart until a cookie exists", () => {
    const local = fakeStorage();
    local.setItem(CART_KEY, JSON.stringify([{ productId: P2, quantity: 4 }]));
    const s = createCookieCartStorage({
      jar: fakeJar(),
      domain: "saloree.com",
      secure: true,
      fallback: createLocalCartStorage(local),
    });
    expect(s.load()).toEqual([{ productId: P2, quantity: 4 }]);
  });

  it("falls back to localStorage when cookies are blocked", () => {
    const local = fakeStorage();
    const s = createCookieCartStorage({
      jar: fakeJar({ blocked: true }),
      domain: "saloree.com",
      secure: true,
      fallback: createLocalCartStorage(local),
    });
    s.save([{ productId: P1, quantity: 1 }]);
    expect(JSON.parse(local.getItem(CART_KEY) ?? "[]")).toEqual([{ productId: P1, quantity: 1 }]);
  });

  it("too big for a cookie: keeps every item locally and removes the stale shared copy", () => {
    const jar = fakeJar();
    const local = fakeStorage();
    const s = createCookieCartStorage({
      jar,
      domain: "saloree.com",
      secure: true,
      fallback: createLocalCartStorage(local),
    });
    s.save([{ productId: P1, quantity: 1 }]);
    const many = Array.from({ length: 120 }, (_, i) => ({
      productId: `${P1.slice(0, -3)}${String(i).padStart(3, "0")}`,
      quantity: 1,
    }));
    expect(encodeCart(many).length).toBeGreaterThan(CART_COOKIE_MAX_BYTES);
    s.save(many);
    expect(jar.cookie).not.toContain(`${CART_COOKIE}=`);
    expect(JSON.parse(local.getItem(CART_KEY) ?? "[]")).toHaveLength(120);
  });
});

describe("local storage (development and other hosts)", () => {
  it("round-trips and validates", () => {
    const st = fakeStorage();
    const s = createLocalCartStorage(st);
    s.save([{ productId: P1, quantity: 2 }]);
    expect(s.load()).toEqual([{ productId: P1, quantity: 2 }]);
    st.setItem(CART_KEY, '[{"productId":"x","quantity":-1},"junk",{"productId":"y","quantity":2}]');
    expect(s.load()).toEqual([{ productId: "y", quantity: 2 }]);
    st.setItem(CART_KEY, "{not json");
    expect(s.load()).toEqual([]);
  });
  it("works with no storage at all", () => {
    const s = createLocalCartStorage(null);
    expect(() => s.save([{ productId: P1, quantity: 1 }])).not.toThrow();
    expect(s.load()).toEqual([]);
  });
});
