/**
 * POST /api/pageview — counts one page view for the site-wide visitor
 * analytics (admin → Visitors). Server only.
 *
 * Always answers 204 with an empty body, whatever happens: the page never
 * waits for it or sees an error. Do Not Track / Global Privacy Control and
 * bots: nothing is stored. Never logs the IP address, the user agent, the
 * visitor code or the body. TRACK_SALT is a server-only secret.
 */
import { supabase } from "./supabase";
import { clientIp, isBot, optedOut, utcDay } from "./track-core";
import {
  firstLanguage,
  geoFromHeaders,
  isTrackedPath,
  MAX_PAGEVIEW_BODY,
  pageviewBodySchema,
  parseUserAgent,
  siteVisitorHash,
} from "./pageview-core";

/** Exactly the arguments of record_site_view. */
export interface SiteViewArgs {
  p_visitor: string;
  p_path: string;
  p_entry: boolean;
  p_referrer_host: string | null;
  p_utm_source: string | null;
  p_utm_medium: string | null;
  p_utm_campaign: string | null;
  p_country: string | null;
  p_region: string | null;
  p_city: string | null;
  p_device: string;
  p_browser: string;
  p_os: string;
  p_lang: string | null;
  p_store_id: string | null;
}

export interface PageviewDeps {
  salt: () => string | undefined;
  now: () => Date;
  record: (
    args: SiteViewArgs,
  ) => PromiseLike<{ error: { code?: string; message?: string } | null }>;
  warn: (message: string) => void;
}

const readSalt = () => {
  const value = typeof process === "undefined" ? undefined : process.env["TRACK_SALT"];
  return value?.trim() || undefined;
};

export const defaultPageviewDeps: PageviewDeps = {
  salt: readSalt,
  now: () => new Date(),
  // The publishable key (anonymous role); record_site_view is granted to anon.
  record: (args) => supabase.rpc("record_site_view", { ...args }),
  warn: (message) => console.warn(message),
};

const noContent = () => new Response(null, { status: 204 });

let warnedNoSalt = false;
/** For tests. */
export const resetPageviewWarnings = () => {
  warnedNoSalt = false;
};

export async function handlePageview(
  request: Request,
  deps: PageviewDeps = defaultPageviewDeps,
): Promise<Response> {
  try {
    if (request.method !== "POST") return noContent();
    const headers = request.headers;
    if (optedOut(headers)) return noContent();
    const userAgent = headers.get("user-agent") ?? "";
    if (isBot(userAgent)) return noContent();
    const salt = deps.salt();
    if (!salt) {
      if (!warnedNoSalt) {
        warnedNoSalt = true;
        deps.warn(
          "Site visitors are not recorded: the TRACK_SALT environment variable is not set.",
        );
      }
      return noContent();
    }
    const ip = clientIp(headers);
    if (!ip) return noContent();

    const raw = await request.text();
    if (!raw || raw.length > MAX_PAGEVIEW_BODY) return noContent();
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return noContent();
    }
    const parsed = pageviewBodySchema.safeParse(json);
    if (!parsed.success) return noContent();
    const body = parsed.data;
    // The browser already skips these; checked again so a hand-made request can't add them.
    if (!isTrackedPath(body.path)) return noContent();

    const { device, browser, os } = parseUserAgent(userAgent);
    const geo = geoFromHeaders(headers);
    // Where the visit came from only counts on its first page.
    const entry = body.is_entry;
    const { error } = await deps.record({
      p_visitor: await siteVisitorHash({ salt, day: utcDay(deps.now()), ip, userAgent }),
      p_path: body.path,
      p_entry: entry,
      p_referrer_host: (entry && body.referrer_host) || null,
      p_utm_source: (entry && body.utm_source) || null,
      p_utm_medium: (entry && body.utm_medium) || null,
      p_utm_campaign: (entry && body.utm_campaign) || null,
      p_country: geo.country,
      p_region: geo.region,
      p_city: geo.city,
      p_device: device,
      p_browser: browser,
      p_os: os,
      p_lang: firstLanguage(headers.get("accept-language")),
      p_store_id: body.store_id ?? null,
    });
    // The database's own error (e.g. the function doesn't exist yet); no visitor data in it.
    if (error) deps.warn(`record_site_view failed: ${error.code ?? ""} ${error.message ?? ""}`);
  } catch (e) {
    // Only the error's type: a message could in theory quote request data.
    deps.warn(`A site visit could not be recorded (${e instanceof Error ? e.name : "error"}).`);
  }
  return noContent();
}
