import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: vi.fn() } }));

import {
  clientIp,
  isBot,
  optedOut,
  trackBodySchema,
  trackCountry,
  utcDay,
  visitorHash,
} from "@/lib/track-core";
import { handleTrack, resetTrackWarnings, type TrackDeps } from "@/lib/track.server";

const IP = "203.0.113.77";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";
const STORE = "6f1c2b0a-4d3e-4f5a-9b8c-7d6e5f4a3b2c";
const SALT = "test-salt-not-a-secret";
const NOW = new Date("2026-11-14T22:30:00Z");

const base = { ip: IP, userAgent: UA, storeId: STORE, day: "2026-11-14", salt: SALT };

describe("visitorHash", () => {
  it("is deterministic, 40 lowercase hex characters, and never contains the IP", async () => {
    const a = await visitorHash(base);
    expect(a).toBe(await visitorHash({ ...base }));
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(a).not.toContain(IP);
    expect(a).not.toContain(IP.replaceAll(".", ""));
  });

  it("differs across day, store, salt, IP and browser", async () => {
    const a = await visitorHash(base);
    for (const change of [
      { day: "2026-11-15" },
      { storeId: "11111111-2222-4333-8444-555555555555" },
      { salt: "another-salt" },
      { ip: "203.0.113.78" },
      { userAgent: `${UA} Edg/131.0` },
    ])
      expect(await visitorHash({ ...base, ...change })).not.toBe(a);
  });

  it("is sha256(ip|ua|store|day|salt), first 40 hex characters", async () => {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${IP}|${UA}|${STORE}|2026-11-14|${SALT}`),
    );
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    expect(await visitorHash(base)).toBe(hex.slice(0, 40));
  });

  it("uses the UTC day", () => {
    expect(utcDay(new Date("2026-11-14T23:59:59Z"))).toBe("2026-11-14");
    expect(utcDay(new Date("2026-11-15T00:00:00Z"))).toBe("2026-11-15");
  });
});

describe("who is counted", () => {
  it("ignores bots, scripts, link previews, uptime checks and empty user agents", () => {
    for (const ua of [
      "",
      "   ",
      null,
      "Googlebot/2.1 (+http://www.google.com/bot.html)",
      "Mozilla/5.0 (compatible; bingbot/2.0)",
      "Baiduspider",
      "Mozilla/5.0 (compatible; Yahoo! Slurp)",
      "Mozilla/5.0 HeadlessChrome/120.0",
      "facebookexternalhit/1.1 Preview",
      "curl/8.4.0",
      "Wget/1.21",
      "python-requests/2.31",
      "Chrome-Lighthouse",
      "UptimeRobot Monitor",
      "SomeCrawler/1.0",
    ])
      expect(isBot(ua), String(ua)).toBe(true);
    expect(isBot(UA)).toBe(false);
  });

  it("respects Do Not Track and Global Privacy Control", () => {
    expect(optedOut(new Headers({ dnt: "1" }))).toBe(true);
    expect(optedOut(new Headers({ "sec-gpc": "1" }))).toBe(true);
    expect(optedOut(new Headers({ dnt: "0" }))).toBe(false);
    expect(optedOut(new Headers())).toBe(false);
  });

  it("reads the country header, with XX when missing or invalid", () => {
    expect(trackCountry(new Headers({ "x-vercel-ip-country": "tr" }))).toBe("TR");
    expect(trackCountry(new Headers({ "cf-ipcountry": "DE" }))).toBe("DE");
    expect(trackCountry(new Headers())).toBe("XX");
    for (const bad of ["T1", "XX", "TUR", "1A", ""])
      expect(trackCountry(new Headers({ "x-vercel-ip-country": bad })), bad).toBe("XX");
  });

  it("takes the first x-forwarded-for address, else x-real-ip", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": `${IP}, 10.0.0.1` }))).toBe(IP);
    expect(clientIp(new Headers({ "x-real-ip": IP }))).toBe(IP);
    expect(clientIp(new Headers())).toBeNull();
  });

  it("accepts only { store_id: uuid }", () => {
    expect(trackBodySchema.safeParse({ store_id: STORE }).success).toBe(true);
    for (const bad of [
      {},
      { store_id: "nope" },
      { store_id: STORE, path: "/x" },
      { store_id: STORE, user_id: "u" },
      null,
      [STORE],
    ])
      expect(trackBodySchema.safeParse(bad).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The route handler
// ---------------------------------------------------------------------------
function deps(patch: Partial<TrackDeps> = {}) {
  const warnings: string[] = [];
  const record = vi.fn(async () => ({ error: null }));
  const d: TrackDeps = {
    salt: () => SALT,
    now: () => NOW,
    record,
    warn: (m) => warnings.push(m),
    ...patch,
  };
  return { d, record: d.record as typeof record, warnings };
}

const request = (
  body: string | null = JSON.stringify({ store_id: STORE }),
  headers: Record<string, string> = {},
  method = "POST",
) =>
  new Request("https://shop.saloree.com/api/track", {
    method,
    body: method === "GET" ? null : body,
    headers: {
      "user-agent": UA,
      "x-forwarded-for": `${IP}, 10.0.0.1`,
      "x-vercel-ip-country": "tr",
      ...headers,
    },
  });

async function expect204(res: Response) {
  expect(res.status).toBe(204);
  expect(await res.text()).toBe("");
}

beforeEach(() => resetTrackWarnings());

describe("POST /api/track", () => {
  it("records one visit with the country and the daily hash", async () => {
    const { d, record } = deps();
    await expect204(await handleTrack(request(), d));
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      p_store_id: STORE,
      p_country: "TR",
      p_visitor: await visitorHash({ ...base, day: "2026-11-14" }),
    });
  });

  it("answers 204 with an empty body for every bad input, without recording", async () => {
    const cases: [string, Request][] = [
      ["GET", request(null, {}, "GET")],
      ["invalid JSON", request("{not json")],
      ["empty body", request("")],
      ["no store_id", request("{}")],
      ["not a uuid", request(JSON.stringify({ store_id: "abc" }))],
      ["extra field", request(JSON.stringify({ store_id: STORE, path: "/secret" }))],
      ["huge body", request(JSON.stringify({ store_id: STORE, x: "a".repeat(5000) }))],
      ["bot", request(undefined, { "user-agent": "Googlebot/2.1" })],
      ["empty user agent", request(undefined, { "user-agent": "" })],
      ["DNT", request(undefined, { dnt: "1" })],
      ["GPC", request(undefined, { "sec-gpc": "1" })],
      ["no IP", request(undefined, { "x-forwarded-for": "" })],
    ];
    for (const [name, req] of cases) {
      const { d, record } = deps();
      const res = await handleTrack(req, d);
      expect(res.status, name).toBe(204);
      expect(await res.text(), name).toBe("");
      expect(record, name).not.toHaveBeenCalled();
    }
  });

  it("missing TRACK_SALT: records nothing and warns once, generically", async () => {
    const { d, record, warnings } = deps({ salt: () => undefined });
    await expect204(await handleTrack(request(), d));
    await expect204(await handleTrack(request(), d));
    expect(record).not.toHaveBeenCalled();
    expect(warnings).toEqual([
      "Store traffic is not recorded: the TRACK_SALT environment variable is not set.",
    ]);
  });

  it("swallows database errors and crashes, still 204", async () => {
    const failing = deps({
      record: async () => ({
        error: {
          code: "PGRST202",
          message: "Could not find the function public.record_store_visit",
        },
      }),
    });
    await expect204(await handleTrack(request(), failing.d));
    expect(failing.warnings[0]).toContain("PGRST202");

    const throwing = deps({
      record: () => {
        throw new TypeError(`fetch failed for ${IP} ${UA}`);
      },
    });
    await expect204(await handleTrack(request(), throwing.d));
    expect(throwing.warnings).toEqual(["Store traffic could not be recorded (TypeError)."]);
  });

  it("never logs the IP address, the user agent or the hash", async () => {
    const logged: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((k) =>
      vi.spyOn(console, k).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      }),
    );
    try {
      const all: string[] = [];
      for (const patch of [
        {},
        { salt: () => undefined },
        { record: async () => ({ error: { code: "X", message: "boom" } }) },
        {
          record: () => {
            throw new Error(`${IP} ${UA}`);
          },
        },
      ] as Partial<TrackDeps>[]) {
        resetTrackWarnings();
        const { d, warnings } = deps(patch);
        await handleTrack(request(), d);
        all.push(...warnings);
      }
      const hash = await visitorHash(base);
      for (const line of [...all, ...logged]) {
        expect(line).not.toContain(IP);
        expect(line).not.toContain("Mozilla");
        expect(line).not.toContain(hash);
      }
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Source checks
// ---------------------------------------------------------------------------
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const TRACKING_FILES = [
  "src/lib/track-core.ts",
  "src/lib/track.server.ts",
  "src/lib/storefront-tracking.ts",
  "src/routes/api.track.ts",
  "src/components/marketplace/storefront-tracker.tsx",
];

describe("tracking code: privacy by construction", () => {
  it("uses no cookies, browser storage or fingerprinting APIs", () => {
    for (const f of TRACKING_FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(
        /document\.cookie|setCookie|getCookie|localStorage|sessionStorage|indexedDB|\bcanvas\b|getContext\(|navigator\.(plugins|hardwareConcurrency|deviceMemory)|screen\.(width|height)/,
      );
    }
  });

  it("never uses a service-role key, and the salt is server-only", () => {
    for (const f of TRACKING_FILES) {
      const src = read(f);
      expect(src, f).not.toMatch(/service_role|SERVICE_ROLE/i);
      expect(src, f).not.toMatch(/VITE_TRACK_SALT/);
    }
    expect(read("src/lib/track.server.ts")).toMatch(/process\.env\["TRACK_SALT"\]/);
    expect(read(".env.example")).toMatch(/^TRACK_SALT=$/m);
  });

  it("the route hands every POST to handleTrack", () => {
    expect(read("src/routes/api.track.ts")).toMatch(
      /POST: \(\{ request \}\) => handleTrack\(request\)/,
    );
  });
});
