/**
 * Site-wide visitor analytics: the pure parts of POST /api/pageview and of the
 * browser tracker (no I/O, so they're tested directly).
 *
 * Privacy:
 *  - Nothing is stored on the visitor's device (no cookies, no browser storage).
 *  - The IP address and the user agent are used only in memory, on the server,
 *    to compute a one-way daily code and the device/browser/system FAMILY.
 *    They are never stored, sent to the database or logged.
 *  - Only the referrer's host name is sent, never the full address, and only
 *    the path of a page (no query string, no #hash).
 */
import { z } from "zod";
import { detectCountryFromHeaders } from "./country-detect";
import { sha256Hex } from "./track-core";

export const PAGEVIEW_PATH = "/api/pageview";

/** Bodies longer than this are ignored without being parsed. */
export const MAX_PAGEVIEW_BODY = 2048;
export const MAX_PATH = 300;
const MAX_TAG = 100;

// ---------------------------------------------------------------------------
// Which pages are counted (browser)
// ---------------------------------------------------------------------------

/** Dashboards, the API and the seller's store preview are never counted. */
const UNTRACKED = /^\/(admin|seller|api|preview)(\/|_|$)/;

/** "/product/x?ref=1#top" → "/product/x": no query string, no hash, no trailing slash. */
export function cleanPath(pathname: string): string {
  let path = pathname.split(/[?#]/, 1)[0] ?? "";
  if (!path.startsWith("/")) path = `/${path}`;
  path = path.replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path.slice(0, MAX_PATH) || "/";
}

export const isTrackedPath = (path: string) => !UNTRACKED.test(cleanPath(path));

/**
 * The host name of `document.referrer`, lowercase; "" when there is none, it
 * isn't a web address, or it is this site (the same host, or both on the
 * marketplace domain, e.g. a store's own site and the main site).
 */
export function referrerHost(
  referrer: string | null | undefined,
  currentHost: string,
  rootDomain = "",
): string {
  if (!referrer) return "";
  let host: string;
  try {
    const u = new URL(referrer);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    host = u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
  const here = currentHost.toLowerCase().replace(/^www\./, "");
  const root = rootDomain.toLowerCase();
  const onRoot = (h: string) => !!root && (h === root || h.endsWith(`.${root}`));
  if (host === here || (onRoot(host) && onRoot(here))) return "";
  return host.slice(0, 253);
}

const tag = (v: string | null) => {
  const t = v?.trim().slice(0, MAX_TAG);
  return t ? t : undefined;
};

/** utm_source / utm_medium / utm_campaign from the address (only the ones present). */
export function utmFrom(search: string) {
  const q = new URLSearchParams(search);
  const out: { utm_source?: string; utm_medium?: string; utm_campaign?: string } = {};
  const source = tag(q.get("utm_source"));
  const medium = tag(q.get("utm_medium"));
  const campaign = tag(q.get("utm_campaign"));
  if (source) out.utm_source = source;
  if (medium) out.utm_medium = medium;
  if (campaign) out.utm_campaign = campaign;
  return out;
}

// ---------------------------------------------------------------------------
// The request body
// ---------------------------------------------------------------------------
const HOST_RE = /^[a-z0-9.-]{1,253}$/;
const optionalTag = z.string().trim().max(MAX_TAG).optional();

/** The only accepted body. Unknown fields are refused. */
export const pageviewBodySchema = z
  .object({
    path: z
      .string()
      .min(1)
      .max(MAX_PATH)
      .refine((p) => p.startsWith("/"), "The path must start with /"),
    is_entry: z.boolean(),
    referrer_host: z
      .string()
      .max(253)
      .refine((h) => h === "" || HOST_RE.test(h), "A host name only")
      .optional(),
    utm_source: optionalTag,
    utm_medium: optionalTag,
    utm_campaign: optionalTag,
    store_id: z.string().uuid().optional(),
  })
  .strict();
export type PageviewBody = z.infer<typeof pageviewBodySchema>;

// ---------------------------------------------------------------------------
// Server: what is derived from the request (in memory only)
// ---------------------------------------------------------------------------
export type DeviceType = "desktop" | "mobile" | "tablet" | "other";

/** Device, browser and system FAMILY from the user agent. The user agent itself is not kept. */
export function parseUserAgent(ua: string): { device: DeviceType; browser: string; os: string } {
  const device: DeviceType =
    /iPad|Tablet|PlayBook|Silk|Kindle/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))
      ? "tablet"
      : /Mobi|iPhone|iPod|Android|Windows Phone|IEMobile/i.test(ua)
        ? "mobile"
        : /Windows NT|Macintosh|X11|Linux|CrOS/i.test(ua)
          ? "desktop"
          : "other";

  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser\//.test(ua)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS\//.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS\/|Chromium\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua) && /Version\//.test(ua)
              ? "Safari"
              : "Other";

  const os = /Windows Phone/i.test(ua)
    ? "Windows Phone"
    : /Windows NT|Win64|Win32/i.test(ua)
      ? "Windows"
      : /iPhone|iPad|iPod/i.test(ua)
        ? "iOS"
        : /Android/i.test(ua)
          ? "Android"
          : /CrOS/i.test(ua)
            ? "ChromeOS"
            : /Mac OS X|Macintosh/i.test(ua)
              ? "macOS"
              : /Linux|X11/i.test(ua)
                ? "Linux"
                : "Other";

  return { device, browser, os };
}

/** The first language of Accept-Language: "de", "en-US", "pt-BR" (2 to 5 characters), else null. */
export function firstLanguage(header: string | null | undefined): string | null {
  const first = header?.split(",")[0]?.split(";")[0]?.trim() ?? "";
  const m = /^([a-z]{2,3})(?:-([a-z0-9]{2,4}))?/i.exec(first);
  if (!m?.[1]) return null;
  const lang = m[1].toLowerCase();
  const region = m[2] && /^[a-z]{2}$/i.test(m[2]) ? `-${m[2].toUpperCase()}` : "";
  const out = `${lang}${region}`;
  return out.length <= 5 ? out : lang.length <= 5 ? lang : null;
}

/** Approximate location from the hosting platform (Vercel); null when missing. */
export function geoFromHeaders(headers: Headers): {
  country: string | null;
  region: string | null;
  city: string | null;
} {
  const region = headers.get("x-vercel-ip-country-region")?.trim() ?? "";
  let city = headers.get("x-vercel-ip-city")?.trim() ?? "";
  try {
    city = decodeURIComponent(city);
  } catch {
    city = "";
  }
  // No control characters (a header could carry them).
  city = [...city]
    .filter((c) => c.charCodeAt(0) >= 32)
    .join("")
    .trim();
  return {
    country: detectCountryFromHeaders(headers),
    region: /^[A-Za-z0-9-]{1,10}$/.test(region) ? region.toUpperCase() : null,
    city: city ? city.slice(0, 100) : null,
  };
}

/**
 * The anonymous daily visitor code: sha256(salt | utcDay | ip | userAgent)
 * as hex. It changes every day, and without the secret salt it can't be
 * reversed by trying IP addresses.
 */
export const siteVisitorHash = (input: {
  salt: string;
  day: string;
  ip: string;
  userAgent: string;
}) => sha256Hex([input.salt, input.day, input.ip, input.userAgent]);
