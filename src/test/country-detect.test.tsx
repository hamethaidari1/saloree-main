import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { DeliverTo } from "@/components/marketplace/header/country-picker";
import { COUNTRIES, CountryProvider, type CountryCode } from "@/lib/country";
import { DELIVERY_COUNTRY_BY_ISO, deliveryCountryForIso } from "@/lib/countries";
import {
  COUNTRY_HEADERS,
  detectCountryFromHeaders,
  devCountryOverride,
  parseCountryHeader,
} from "@/lib/country-detect";
import {
  buildCountryCookie,
  COUNTRY_COOKIE_MAX_AGE,
  countryCookieOptions,
  readCountryCookie,
} from "@/lib/country-cookie";
import {
  isQuietPath,
  readDismissedAt,
  saveDismissedAt,
  shouldSuggestCountry,
  SUGGEST_DISMISS_KEY,
} from "@/lib/country-suggest";
import { renderWithRouter } from "./router-harness";
import { WithLocale } from "./i18n";
import type { Locale } from "@/i18n/locales";

// ---------------------------------------------------------------------------
// Header → country
// ---------------------------------------------------------------------------
describe("detectCountryFromHeaders", () => {
  it("reads Vercel's header first, then Cloudflare's", () => {
    expect(COUNTRY_HEADERS).toEqual(["x-vercel-ip-country", "cf-ipcountry"]);
    expect(detectCountryFromHeaders(new Headers({ "x-vercel-ip-country": "TR" }))).toBe("TR");
    expect(detectCountryFromHeaders(new Headers({ "cf-ipcountry": "de" }))).toBe("DE");
    expect(
      detectCountryFromHeaders(new Headers({ "x-vercel-ip-country": "FI", "cf-ipcountry": "SE" })),
    ).toBe("FI");
    // An unusable Vercel value falls through to Cloudflare.
    expect(
      detectCountryFromHeaders(new Headers({ "x-vercel-ip-country": "XX", "cf-ipcountry": "NL" })),
    ).toBe("NL");
  });

  it("accepts a plain object (any header case, array values) or a getter", () => {
    expect(detectCountryFromHeaders({ "X-Vercel-IP-Country": ["gb", "fr"] })).toBe("GB");
    expect(detectCountryFromHeaders((name) => (name === "cf-ipcountry" ? " af " : undefined))).toBe(
      "AF",
    );
    expect(detectCountryFromHeaders({})).toBeNull();
  });

  it.each([
    ["XX", null],
    ["T1", null],
    ["", null],
    ["   ", null],
    ["TUR", null],
    ["T", null],
    ["1A", null],
    ["Ü1", null],
    ["tr", "TR"],
    [" Tr ", "TR"],
    ["BR", "BR"],
  ])("%j → %s", (value, expected) => {
    expect(parseCountryHeader(value)).toBe(expected);
  });

  it("non-strings are ignored", () => {
    expect(parseCountryHeader(undefined)).toBeNull();
    expect(parseCountryHeader(42)).toBeNull();
    expect(parseCountryHeader(["TR"])).toBeNull();
  });

  it("?country= works in development only", () => {
    expect(devCountryOverride({ country: "tr" }, true)).toBe("TR");
    expect(devCountryOverride({ country: "TR" }, false)).toBeNull();
    expect(devCountryOverride({ country: "<b>" }, true)).toBeNull();
    expect(devCountryOverride({}, true)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Mapping vs. the selector list
// ---------------------------------------------------------------------------
describe("country mapping", () => {
  it("covers exactly the selector's real countries (stays in sync with COUNTRIES)", () => {
    const listed = COUNTRIES.map((c) => c.code).filter((c) => c !== "OTHER");
    expect(Object.keys(DELIVERY_COUNTRY_BY_ISO).sort()).toEqual([...listed].sort());
    for (const code of listed) expect(deliveryCountryForIso(code)).toBe(code);
  });
  it("the agreed countries map; others (and Other) do not", () => {
    expect(["AF", "FI", "DE", "FR", "SE", "NL", "TR", "GB"].map(deliveryCountryForIso)).toEqual([
      "AF",
      "FI",
      "DE",
      "FR",
      "SE",
      "NL",
      "TR",
      "GB",
    ]);
    expect(deliveryCountryForIso("tr")).toBe("TR");
    expect(deliveryCountryForIso("BR")).toBeNull();
    expect(deliveryCountryForIso("US")).toBeNull();
    expect(deliveryCountryForIso("OTHER")).toBeNull();
    expect(deliveryCountryForIso(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Cookie
// ---------------------------------------------------------------------------
describe("country cookie", () => {
  it("production on the real domain: shared with store subdomains, Secure, 1 year", () => {
    const opts = countryCookieOptions({
      dev: false,
      rootDomain: "saloree.com",
      host: "alpha.saloree.com",
      https: true,
    });
    expect(buildCountryCookie("TR", opts)).toBe(
      `country=TR; Path=/; Max-Age=${COUNTRY_COOKIE_MAX_AGE}; SameSite=Lax; Domain=.saloree.com; Secure`,
    );
    expect(COUNTRY_COOKIE_MAX_AGE).toBe(31_536_000);
  });
  it("development: host-only, not Secure", () => {
    const opts = countryCookieOptions({
      dev: true,
      rootDomain: "saloree.com",
      host: "localhost",
      https: false,
    });
    expect(buildCountryCookie("DE", opts)).toBe(
      `country=DE; Path=/; Max-Age=${COUNTRY_COOKIE_MAX_AGE}; SameSite=Lax`,
    );
  });
  it("reads only known codes back", () => {
    expect(readCountryCookie("lang=de; country=FI; x=1")).toBe("FI");
    expect(readCountryCookie("country=OTHER")).toBe("OTHER");
    expect(readCountryCookie("country=BR")).toBeNull();
    expect(readCountryCookie("country=%E0%A4%A")).toBeNull();
    expect(readCountryCookie("")).toBeNull();
    expect(readCountryCookie(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// When to offer
// ---------------------------------------------------------------------------
describe("shouldSuggestCountry", () => {
  const now = Date.parse("2026-11-13T12:00:00Z");
  const base = { saved: null, detected: "TR", dismissedAt: null, now, pathname: "/" };
  const DAY = 86_400_000;

  it("first visit with a supported country → offer it", () => {
    expect(shouldSuggestCountry(base)).toBe("TR");
  });
  it("a saved choice is never overridden (even a different one, or Other)", () => {
    expect(shouldSuggestCountry({ ...base, saved: "DE" })).toBeNull();
    expect(shouldSuggestCountry({ ...base, saved: "TR" })).toBeNull();
    expect(shouldSuggestCountry({ ...base, saved: "OTHER" })).toBeNull();
  });
  it("unsupported or unknown country → nothing", () => {
    expect(shouldSuggestCountry({ ...base, detected: "BR" })).toBeNull();
    expect(shouldSuggestCountry({ ...base, detected: null })).toBeNull();
  });
  it("closed without choosing → hidden for 30 days, then offered again", () => {
    expect(shouldSuggestCountry({ ...base, dismissedAt: now - 29 * DAY })).toBeNull();
    expect(shouldSuggestCountry({ ...base, dismissedAt: now - 30 * DAY })).toBe("TR");
  });
  it("never on buying, sign-in or account pages", () => {
    for (const p of [
      "/checkout",
      "/cart",
      "/login",
      "/register",
      "/account",
      "/order-confirmation/x",
      "/forgot-password",
    ]) {
      expect(isQuietPath(p)).toBe(true);
      expect(shouldSuggestCountry({ ...base, pathname: p })).toBeNull();
    }
    expect(isQuietPath("/products")).toBe(false);
    expect(isQuietPath("/accountant")).toBe(false);
  });
  it("dismissal is remembered in storage (and survives blocked storage)", () => {
    localStorage.clear();
    expect(readDismissedAt()).toBeNull();
    saveDismissedAt(now);
    expect(readDismissedAt()).toBe(now);
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readDismissedAt(blocked)).toBeNull();
    expect(() => saveDismissedAt(now, blocked)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The offer in the header
// ---------------------------------------------------------------------------
describe("'Deliver to …?' offer", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "country=; Max-Age=0; Path=/";
    // jsdom has no layout: treat the chip as visible.
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue([
      {} as DOMRect,
    ] as unknown as DOMRectList);
  });
  afterEach(() => vi.restoreAllMocks());

  const display = (code: string, locale = "en") =>
    new Intl.DisplayNames([locale], { type: "region" }).of(code)!;
  const show = (
    opts: {
      saved?: CountryCode | null;
      detected?: string | null;
      path?: string;
      locale?: Locale;
    } = {},
    variant: "block" | "strip" = "block",
  ) =>
    renderWithRouter(
      <WithLocale locale={opts.locale ?? "en"}>
        <CountryProvider initial={opts.saved ?? null} detected={opts.detected ?? null}>
          <DeliverTo variant={variant} />
          <button type="button">Elsewhere</button>
        </CountryProvider>
      </WithLocale>,
      opts.path ?? "/",
    );

  it("first visit from Türkiye: a labelled dialog, focus inside, 44px buttons", async () => {
    show({ detected: "TR" });
    const name = display("TR");
    const dialog = await screen.findByRole("dialog", { name: `Deliver to ${name}?` });
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(dialog).toHaveAccessibleDescription("We use this to show delivery details at checkout.");
    const accept = within(dialog).getByRole("button", { name: `Deliver to ${name}` });
    await waitFor(() => expect(document.activeElement).toBe(accept));
    expect(within(dialog).getByRole("button", { name: "Choose another country" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Close" })).toHaveClass(
      "country-suggest-close",
    );
    // Nothing changed silently.
    expect(screen.getByRole("button", { name: /deliver to no country selected/i })).toBeTruthy();
    expect(readCountryCookie(document.cookie)).toBeNull();
  });

  it("accept → saved in the cookie, chip updated, dialog closed, focus back on the chip", async () => {
    show({ detected: "DE" });
    const dialog = await screen.findByRole("dialog", { name: "Deliver to Germany?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Deliver to Germany" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const chip = screen.getByRole("button", { name: /deliver to germany/i });
    expect(chip).toHaveTextContent("Germany");
    expect(document.activeElement).toBe(chip);
    expect(readCountryCookie(document.cookie)).toBe("DE");
  });

  it("Esc closes it, remembers 'not now' and returns focus to the chip", async () => {
    show({ detected: "FR" });
    await screen.findByRole("dialog", { name: "Deliver to France?" });
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /deliver to/i }));
    expect(Number(localStorage.getItem(SUGGEST_DISMISS_KEY))).toBeGreaterThan(0);
    expect(readCountryCookie(document.cookie)).toBeNull();
  });

  it("the X closes it; it stays hidden on the next visit", async () => {
    const first = show({ detected: "SE" });
    const dialog = await screen.findByRole("dialog", { name: "Deliver to Sweden?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    first.unmount();
    show({ detected: "SE" });
    await screen.findByRole("button", { name: /deliver to/i });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("'Choose another country' opens the existing list; picking there saves", async () => {
    show({ detected: "NL" });
    const dialog = await screen.findByRole("dialog", { name: `Deliver to ${display("NL")}?` });
    fireEvent.click(within(dialog).getByRole("button", { name: "Choose another country" }));
    const list = await screen.findByRole("list", { name: "Delivery countries" });
    fireEvent.click(within(list).getByRole("button", { name: "Finland" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /deliver to finland/i })).toBeTruthy(),
    );
    expect(readCountryCookie(document.cookie)).toBe("FI");
  });

  it("a saved choice: never offered, never changed (travelling / VPN)", async () => {
    show({ saved: "DE", detected: "TR" });
    await screen.findByRole("button", { name: /deliver to germany/i });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("unsupported (BR) or missing header: no offer, chip unchanged", async () => {
    show({ detected: "BR" });
    await screen.findByRole("button", { name: /deliver to no country selected/i });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("not on checkout / login / account", async () => {
    show({ detected: "TR", path: "/checkout" });
    await screen.findByRole("button", { name: /deliver to/i });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("only the visible chip offers it (desktop block or mobile strip, not both)", async () => {
    vi.mocked(HTMLElement.prototype.getClientRects).mockReturnValue([] as unknown as DOMRectList);
    show({ detected: "TR" });
    await screen.findByRole("button", { name: /deliver to/i });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("mobile: a bottom sheet", async () => {
    show({ detected: "GB" }, "strip");
    const dialog = await screen.findByRole("dialog", { name: `Deliver to ${display("GB")}?` });
    expect(dialog).toHaveAttribute("data-variant", "strip");
  });

  it("RTL / other language: the country name and texts in that language", async () => {
    show({ detected: "TR", locale: "ar" });
    const name = display("TR", "ar");
    const dialog = await screen.findByRole("dialog", { name: `التوصيل إلى ${name}؟` });
    expect(within(dialog).getByRole("button", { name: `التوصيل إلى ${name}` })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "إغلاق" })).toBeTruthy();
  });
});
