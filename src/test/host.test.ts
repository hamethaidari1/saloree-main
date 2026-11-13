import { describe, expect, it } from "vitest";
import {
  getStoreSlugFromHost,
  isMainOnlyPath,
  isValidStoreSlug,
  mainSiteUrl,
  normalizeHost,
  RESERVED_STORE_SLUGS,
  resolveDevStore,
  storePublicAddress,
  storeUrl,
  type HostConfig,
} from "@/lib/host";

const ROOT = "saloree.com";

describe("getStoreSlugFromHost", () => {
  it.each([
    ["saloree.com", null, "root domain"],
    ["www.saloree.com", null, "www"],
    ["app.saloree.com", null, "app"],
    ["localhost", null, "localhost"],
    ["localhost:8080", null, "localhost with port"],
    ["127.0.0.1:8080", null, "IP"],
    ["[::1]:8080", null, "IPv6"],
    ["saloree-git-main-team.vercel.app", null, "preview URL"],
    ["nextgen-tech.saloree.com.vercel.app", null, "root domain inside another host"],
    ["evilsaloree.com", null, "suffix without dot"],
    ["a.b.saloree.com", null, "nested subdomain"],
    ["ab.saloree.com", null, "too short to be a store"],
    ["-shop.saloree.com", null, "leading dash"],
    ["nextgen-tech.saloree.com", "nextgen-tech", "store subdomain"],
    ["NextGen-Tech.Saloree.COM", "nextgen-tech", "uppercase"],
    ["nextgen-tech.saloree.com:443", "nextgen-tech", "port number"],
    ["nextgen-tech.saloree.com.", "nextgen-tech", "trailing dot (FQDN)"],
  ])("%s → %s (%s)", (host, expected, _why) => {
    expect(getStoreSlugFromHost(host, ROOT)).toBe(expected);
  });

  it.each([
    ["help.saloree.com", "help"],
    ["api.saloree.com", "api"],
    ["admin.saloree.com", "admin"],
    ["HELP.Saloree.com", "help, uppercase"],
    ["api.saloree.com:443", "api, with port"],
  ])("reserved %s is the main site, not a store (%s)", (host) => {
    expect(getStoreSlugFromHost(host, ROOT)).toBeNull();
  });

  it("every reserved name is treated as the main site", () => {
    for (const name of RESERVED_STORE_SLUGS)
      expect(getStoreSlugFromHost(`${name}.saloree.com`, ROOT), name).toBeNull();
  });

  it.each([
    ["alizada-trends-store.saloree.com", "alizada-trends-store"],
    ["saloreetest-sop.saloree.com", "saloreetest-sop"],
    // Containing a reserved word is fine; only exact names are reserved.
    ["help-desk-kabul.saloree.com", "help-desk-kabul"],
    ["my-shop.saloree.com", "my-shop"],
    ["api2.saloree.com", "api2"],
    ["admins.saloree.com", "admins"],
  ])("normal store address %s still resolves to %s", (host, slug) => {
    expect(getStoreSlugFromHost(host, ROOT)).toBe(slug);
  });

  it("tolerates a root domain written with a leading dot or capitals", () => {
    expect(getStoreSlugFromHost("shop1.saloree.com", ".Saloree.com")).toBe("shop1");
  });
  it("never finds a store when no root domain is configured", () => {
    expect(getStoreSlugFromHost("shop1.saloree.com", "")).toBeNull();
  });
});

describe("normalizeHost", () => {
  it("lowercases and strips port and trailing dot", () => {
    expect(normalizeHost(" Shop.Saloree.com:8080 ")).toBe("shop.saloree.com");
    expect(normalizeHost("[::1]:3000")).toBe("[::1]");
  });
});

describe("store addresses", () => {
  const prod: HostConfig = { rootDomain: ROOT, dev: false };
  const dev: HostConfig = { rootDomain: ROOT, dev: true, origin: "http://localhost:8080" };
  const unset: HostConfig = { rootDomain: "", dev: false };

  it("production links go to the subdomain", () => {
    expect(storeUrl("nextgen-tech", prod)).toBe("https://nextgen-tech.saloree.com");
    expect(storePublicAddress("nextgen-tech", prod)).toBe("https://nextgen-tech.saloree.com");
  });
  it("dev links use ?store= on the current origin (no DNS needed)", () => {
    expect(storeUrl("nextgen-tech", dev)).toBe("http://localhost:8080/?store=nextgen-tech");
  });
  it("without a configured domain, links fall back to the marketplace store page", () => {
    expect(storeUrl("nextgen-tech", unset)).toBe("/store/nextgen-tech");
    expect(storePublicAddress("nextgen-tech", unset)).toBeNull();
  });
  it("main-site links", () => {
    expect(mainSiteUrl("/checkout", prod)).toBe("https://saloree.com/checkout");
    expect(mainSiteUrl("login", prod)).toBe("https://saloree.com/login");
    expect(mainSiteUrl("/checkout", dev)).toBe("/checkout?store=");
    expect(mainSiteUrl("/products?q=fan", dev)).toBe("/products?q=fan&store=");
    expect(mainSiteUrl("/checkout", unset)).toBe("/checkout");
  });
});

describe("dev ?store= override", () => {
  it("a slug in the URL wins and is saved", () =>
    expect(resolveDevStore({ param: "NextGen-Tech", session: "other", cookie: null })).toEqual({
      slug: "nextgen-tech",
      persist: "set",
    }));
  it("empty or 'off' clears it", () => {
    expect(resolveDevStore({ param: "", session: "shop1", cookie: "shop1" })).toEqual({
      slug: null,
      persist: "clear",
    });
    expect(resolveDevStore({ param: "off", session: "shop1", cookie: null }).slug).toBeNull();
  });
  it("without a param, the saved choice (session, then cookie) is used", () => {
    expect(resolveDevStore({ param: undefined, session: "shop1", cookie: "shop2" })).toEqual({
      slug: "shop1",
      persist: null,
    });
    expect(resolveDevStore({ param: undefined, session: null, cookie: "shop2" }).slug).toBe(
      "shop2",
    );
    expect(resolveDevStore({ param: undefined, session: null, cookie: null }).slug).toBeNull();
  });
  it("ignores malformed values", () => {
    expect(resolveDevStore({ param: "../admin", session: null, cookie: null })).toEqual({
      slug: null,
      persist: "clear",
    });
    expect(
      resolveDevStore({ param: undefined, session: "<script>", cookie: null }).slug,
    ).toBeNull();
  });
});

describe("main-only paths on store sites", () => {
  it.each([
    "/seller",
    "/seller/orders",
    "/admin",
    "/checkout",
    "/login",
    "/register",
    "/account",
    "/order-confirmation/x",
    "/stores",
    "/store/other",
  ])("%s goes to the main site", (p) => expect(isMainOnlyPath(p)).toBe(true));
  it.each([
    "/",
    "/products",
    "/product/123",
    "/category/home",
    "/cart",
    "/sellers-guide",
    "/storefront",
  ])("%s stays on the store site", (p) => expect(isMainOnlyPath(p)).toBe(false));
});

describe("isValidStoreSlug", () => {
  it("applies the DNS and reserved-name rules", () => {
    expect(isValidStoreSlug("nextgen-tech")).toBe(true);
    expect(isValidStoreSlug("admin")).toBe(false);
    expect(isValidStoreSlug("Upper")).toBe(false);
  });
});
