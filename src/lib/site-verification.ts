/**
 * Google Search Console's HTML-tag verification, from the server-only
 * environment variable GOOGLE_SITE_VERIFICATION (set it in Vercel; no code
 * change). Only the token itself is accepted (letters, digits, - and _).
 */
import { queryOptions } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";

export const VERIFICATION_RE = /^[A-Za-z0-9_-]{10,128}$/;

/** The token, or null when unset or not token-shaped (e.g. the whole <meta> pasted in). */
export function verificationToken(value: string | undefined | null): string | null {
  const v = value?.trim();
  return v && VERIFICATION_RE.test(v) ? v : null;
}

export const getSiteVerification = createServerFn({ method: "GET" }).handler(async () =>
  verificationToken(
    typeof process === "undefined" ? null : process.env["GOOGLE_SITE_VERIFICATION"],
  ),
);

export const siteVerificationQuery = queryOptions({
  queryKey: ["site-verification"],
  queryFn: () => getSiteVerification(),
  staleTime: Infinity,
});
