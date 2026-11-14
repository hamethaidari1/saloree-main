/**
 * POST /api/track — counts one storefront page view. Server only.
 *
 * Always answers 204 with an empty body, whatever happens: the page never
 * waits for it or sees an error. Never logs the IP address, the user agent or
 * the visitor hash. TRACK_SALT is a server-only secret (never VITE_-prefixed).
 */
import { supabase } from "./supabase";
import {
  clientIp,
  isBot,
  MAX_TRACK_BODY,
  optedOut,
  trackBodySchema,
  trackCountry,
  utcDay,
  visitorHash,
} from "./track-core";

export interface TrackDeps {
  salt: () => string | undefined;
  now: () => Date;
  record: (args: {
    p_store_id: string;
    p_country: string;
    p_visitor: string;
  }) => PromiseLike<{ error: { code?: string; message?: string } | null }>;
  warn: (message: string) => void;
}

const readSalt = () => {
  const value = typeof process === "undefined" ? undefined : process.env["TRACK_SALT"];
  return value?.trim() || undefined;
};

export const defaultTrackDeps: TrackDeps = {
  salt: readSalt,
  now: () => new Date(),
  // The publishable key (anonymous role); record_store_visit is granted to anon.
  record: (args) => supabase.rpc("record_store_visit", args),
  warn: (message) => console.warn(message),
};

const noContent = () => new Response(null, { status: 204 });

let warnedNoSalt = false;
/** For tests. */
export const resetTrackWarnings = () => {
  warnedNoSalt = false;
};

export async function handleTrack(
  request: Request,
  deps: TrackDeps = defaultTrackDeps,
): Promise<Response> {
  try {
    if (request.method !== "POST") return noContent();
    const salt = deps.salt();
    if (!salt) {
      if (!warnedNoSalt) {
        warnedNoSalt = true;
        deps.warn("Store traffic is not recorded: the TRACK_SALT environment variable is not set.");
      }
      return noContent();
    }
    const headers = request.headers;
    if (optedOut(headers)) return noContent();
    const userAgent = headers.get("user-agent") ?? "";
    if (isBot(userAgent)) return noContent();
    const ip = clientIp(headers);
    if (!ip) return noContent();

    const raw = await request.text();
    if (!raw || raw.length > MAX_TRACK_BODY) return noContent();
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return noContent();
    }
    const body = trackBodySchema.safeParse(json);
    if (!body.success) return noContent();

    const storeId = body.data.store_id;
    const visitor = await visitorHash({ ip, userAgent, storeId, day: utcDay(deps.now()), salt });
    const { error } = await deps.record({
      p_store_id: storeId,
      p_country: trackCountry(headers),
      p_visitor: visitor,
    });
    // The database's own error (e.g. the function doesn't exist yet); no visitor data in it.
    if (error) deps.warn(`record_store_visit failed: ${error.code ?? ""} ${error.message ?? ""}`);
  } catch (e) {
    // Only the error's type: a message could in theory quote request data.
    deps.warn(`Store traffic could not be recorded (${e instanceof Error ? e.name : "error"}).`);
  }
  return noContent();
}
