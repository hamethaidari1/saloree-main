/**
 * Store traffic: the pure parts of POST /api/track (no I/O, so they're tested directly).
 *
 * Privacy: nothing is stored on the visitor's device. The IP address and user
 * agent are only used in memory to compute a one-way daily hash; they are
 * never stored, sent to the database or logged.
 */
import { z } from "zod";
import { detectCountryFromHeaders } from "./country-detect";

export const TRACK_PATH = "/api/track";

/** The only accepted body: `{ store_id: uuid }`, nothing else. */
export const trackBodySchema = z.object({ store_id: z.string().uuid() }).strict();

/** Bodies longer than this are ignored without being parsed. */
export const MAX_TRACK_BODY = 256;

const BOT_RE =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|headless|lighthouse|monitor|curl|wget|python/i;

/** Crawlers, link previews, scripts and uptime checks; an empty user agent counts as a bot. */
export function isBot(userAgent: string | null | undefined): boolean {
  const ua = userAgent?.trim() ?? "";
  return ua === "" || BOT_RE.test(ua);
}

/** Do Not Track or Global Privacy Control: such visitors are not counted at all. */
export function optedOut(headers: Headers): boolean {
  return headers.get("dnt")?.trim() === "1" || headers.get("sec-gpc")?.trim() === "1";
}

/** Two-letter country from the hosting platform's header; "XX" when unknown. */
export function trackCountry(headers: Headers): string {
  return detectCountryFromHeaders(headers) ?? "XX";
}

/**
 * The client's IP: the first value of x-forwarded-for, else x-real-ip, else
 * cf-connecting-ip (Cloudflare). Used only in memory for the hash.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip =
    forwarded || headers.get("x-real-ip")?.trim() || headers.get("cf-connecting-ip")?.trim();
  return ip || null;
}

/** "2026-11-14": the UTC day the visit belongs to. */
export const utcDay = (d: Date) => d.toISOString().slice(0, 10);

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** sha256 of the parts joined with "|", as lowercase hex. */
export async function sha256Hex(parts: readonly string[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("|")));
  return hex(digest);
}

/**
 * Anonymous daily visitor id: the first 40 hex characters of
 * sha256(ip | userAgent | storeId | utcDay | salt). It changes every day and
 * differs per store, so a person can't be followed across days or stores, and
 * without the secret salt it can't be reversed by trying IP addresses.
 */
export async function visitorHash(input: {
  ip: string;
  userAgent: string;
  storeId: string;
  day: string;
  salt: string;
}): Promise<string> {
  const parts = [input.ip, input.userAgent, input.storeId, input.day, input.salt];
  return (await sha256Hex(parts)).slice(0, 40);
}
