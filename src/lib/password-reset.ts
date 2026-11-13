/**
 * "Forgot password" (Supabase Auth, PKCE). Pure helpers — schemas, the
 * redirect address, the resend cooldown, error mapping, reading the link —
 * plus the three calls: send the link, open it, set the new password.
 *
 * Privacy: sending never reveals whether an account exists. Only problems
 * that are not about the account (no connection, rate limit) are shown.
 */
import { z } from "zod";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { hostConfig, type HostConfig } from "@/lib/host";
import { errorFromCallbackUrl } from "@/lib/oauth";
import { clearRecoveryMark, hasRecoveryMark } from "@/lib/auth-url";

export const FORGOT_PASSWORD_PATH = "/forgot-password";
export const RESET_PASSWORD_PATH = "/reset-password";

// ---------------------------------------------------------------------------
// Validation (same password rule as sign-up)
// ---------------------------------------------------------------------------
/** Minimum password length — the sign-up rule, shared by sign-up and reset. */
export const PASSWORD_MIN_LENGTH = 8;

export const emailSchema = z
  .string({ required_error: "required" })
  .trim()
  .min(1, "required")
  .max(254, "invalid")
  .email("invalid")
  .transform((v) => v.toLowerCase());

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const newPasswordSchema = z
  .string({ required_error: "required" })
  .min(1, "required")
  .min(PASSWORD_MIN_LENGTH, "tooShort");

export const resetPasswordSchema = z
  .object({ password: newPasswordSchema, confirm: z.string() })
  .refine((v) => v.confirm === v.password, { path: ["confirm"], message: "mismatch" });

/** Field → first problem ("required" | "invalid" | "tooShort" | "mismatch"). */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? "form");
    out[field] ??= issue.message;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Where the email link points: always the main marketplace, never a store
// ---------------------------------------------------------------------------
export function passwordResetRedirect(cfg: HostConfig = hostConfig()): string {
  if (!cfg.dev && cfg.rootDomain) return `https://${cfg.rootDomain}${RESET_PASSWORD_PATH}`;
  // Dev (store mode is ?store=, so the origin is the main site), or no domain
  // configured (no store subdomains exist).
  if (!cfg.origin) throw new Error("The reset link address can only be built in the browser.");
  return `${cfg.origin}${RESET_PASSWORD_PATH}`;
}

// ---------------------------------------------------------------------------
// Resend cooldown
// ---------------------------------------------------------------------------
export const RESEND_COOLDOWN_SECONDS = 60;
const COOLDOWN_KEY = "saloree.reset-sent-at";

/** Whole seconds left before another link may be requested (0 = allowed). */
export function cooldownLeft(
  sentAt: number | null,
  now: number,
  seconds = RESEND_COOLDOWN_SECONDS,
): number {
  if (sentAt == null || !Number.isFinite(sentAt)) return 0;
  const left = Math.ceil((sentAt + seconds * 1000 - now) / 1000);
  return Math.min(seconds, Math.max(0, left)); // a clock moved backwards never means longer
}

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** When the last link was requested in this tab (survives a reload). */
export function readSentAt(): number | null {
  try {
    const v = Number(sessionStore()?.getItem(COOLDOWN_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
export function saveSentAt(at: number) {
  try {
    sessionStore()?.setItem(COOLDOWN_KEY, String(at));
  } catch {
    // Storage blocked: the cooldown still works until the page is reloaded.
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
export type ResetErrorKind =
  | "rateLimit"
  | "network"
  | "samePassword"
  | "weakPassword"
  | "leakedPassword"
  | "linkExpired"
  | "otherBrowser"
  | "sessionMissing";

type ErrorLike = {
  code?: unknown;
  message?: unknown;
  name?: unknown;
  status?: unknown;
  reasons?: unknown;
};

export function resetErrorKind(error: unknown): ResetErrorKind | null {
  const e = (error && typeof error === "object" ? error : {}) as ErrorLike;
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message : "";
  const name = typeof e.name === "string" ? e.name : "";

  if (
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    e.status === 429 ||
    /rate limit|only request this after/i.test(message)
  )
    return "rateLimit";
  if (
    name === "AuthRetryableFetchError" ||
    /failed to fetch|networkerror|load failed|network request failed/i.test(message)
  )
    return "network";
  if (code === "same_password" || /different from the old password/i.test(message))
    return "samePassword";
  if (code === "weak_password" || name === "AuthWeakPasswordError") {
    const reasons = Array.isArray(e.reasons) ? e.reasons : [];
    return reasons.includes("pwned") || /pwned|leaked|data breach/i.test(message)
      ? "leakedPassword"
      : "weakPassword";
  }
  if (code === "pkce_code_verifier_not_found" || name === "AuthPKCECodeVerifierMissingError")
    return "otherBrowser";
  if (
    ["otp_expired", "flow_state_not_found", "flow_state_expired", "bad_code_verifier"].includes(
      code,
    ) ||
    /expired|invalid flow state|already been used|token has expired or is invalid/i.test(message)
  )
    return "linkExpired";
  if (
    name === "AuthSessionMissingError" ||
    code === "session_not_found" ||
    code === "session_expired" ||
    /auth session missing/i.test(message)
  )
    return "sessionMissing";
  return null;
}

/** For "Send reset link": only these are shown; anything else → the neutral message. */
export const isShownSendError = (kind: ResetErrorKind | null) =>
  kind === "rateLimit" || kind === "network";

// ---------------------------------------------------------------------------
// The recovery link
// ---------------------------------------------------------------------------
export type RecoveryLink =
  | { kind: "error"; message: string; code?: string }
  | { kind: "code"; code: string }
  | { kind: "token"; tokenHash: string }
  | { kind: "none" };

/**
 * What the email link carries: an error from Supabase (expired/used link), a
 * PKCE `?code=` (default template), a `token_hash` (custom template that works
 * in any browser) or nothing (opened directly / after a reload).
 */
export function readRecoveryLink(href: string): RecoveryLink {
  const err = errorFromCallbackUrl(href);
  if (err) return { kind: "error", ...err };
  const url = new URL(href);
  const tokenHash = url.searchParams.get("token_hash");
  if (tokenHash && (url.searchParams.get("type") ?? "recovery") === "recovery")
    return { kind: "token", tokenHash };
  const code = url.searchParams.get("code");
  if (code) return { kind: "code", code };
  return { kind: "none" };
}

/** The link's parameters, removed so a reload never reuses a one-time code. */
export function cleanRecoveryUrl(href: string): string {
  const url = new URL(href);
  for (const k of ["code", "token_hash", "type", "error", "error_code", "error_description"])
    url.searchParams.delete(k);
  url.hash = "";
  return `${url.pathname}${url.search}`;
}

/** The `amr` methods in a Supabase access token ("recovery", "password", "otp"…). */
export function sessionAuthMethods(accessToken: string | null | undefined): string[] {
  try {
    const payload = accessToken?.split(".")[1];
    if (!payload) return [];
    const json: unknown = JSON.parse(
      atob(
        payload
          .replace(/-/g, "+")
          .replace(/_/g, "/")
          .padEnd(Math.ceil(payload.length / 4) * 4, "="),
      ),
    );
    const amr = (json as { amr?: unknown }).amr;
    if (!Array.isArray(amr)) return [];
    return amr
      .map((a: unknown) =>
        a && typeof a === "object" ? (a as { method?: unknown }).method : undefined,
      )
      .filter((m): m is string => typeof m === "string");
  } catch {
    return [];
  }
}

/**
 * A recovery session: this tab received PASSWORD_RECOVERY for this user (see
 * supabase.ts), or the token itself says it came from a recovery link.
 */
export function isRecoverySession(session: Session | null): boolean {
  if (!session) return false;
  return (
    hasRecoveryMark(session.user.id) ||
    sessionAuthMethods(session.access_token).includes("recovery")
  );
}

export type InvalidReason = ResetErrorKind | "noLink" | "other";
export type RecoveryResult =
  | { status: "ready"; email: string | null }
  | { status: "invalid"; reason: InvalidReason; detail?: string };

const invalid = (error: { message: string }): RecoveryResult => {
  const kind = resetErrorKind(error);
  return kind
    ? { status: "invalid", reason: kind }
    : { status: "invalid", reason: "other", detail: error.message };
};

/** PASSWORD_RECOVERY is sent just after the session is saved; give it a moment. */
async function waitForRecovery(session: Session, ms = 2000): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (isRecoverySession(session)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return isRecoverySession(session);
}

/**
 * Opens the recovery link. The Supabase client exchanges the `?code=` itself
 * when it starts (PKCE); a `token_hash` link is verified here. Either way the
 * result is a short "recovery" session (PASSWORD_RECOVERY), and only then is
 * the form shown.
 */
export async function openRecoveryLink(href: string): Promise<RecoveryResult> {
  const link = readRecoveryLink(href);
  if (link.kind === "error") {
    const kind = resetErrorKind(link);
    return { status: "invalid", reason: kind ?? "linkExpired", detail: link.message };
  }

  const { error: initError } = await supabase.auth.initialize();
  if (initError && link.kind === "code") return invalid(initError);

  if (link.kind === "token") {
    const { error } = await supabase.auth.verifyOtp({
      type: "recovery",
      token_hash: link.tokenHash,
    });
    if (error) return invalid(error);
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (session && (await waitForRecovery(session, link.kind === "none" ? 0 : 2000)))
    return { status: "ready", email: session.user.email ?? null };
  // The code is still in the address and there is no recovery session: this
  // browser could not use it (already used, or asked for in another browser).
  if (link.kind === "code") return { status: "invalid", reason: "otherBrowser" };
  if (link.kind === "none") return { status: "invalid", reason: "noLink" };
  return { status: "invalid", reason: "linkExpired" };
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------
/**
 * Asks Supabase to email a reset link. Resolves for every address (Supabase
 * itself does not say whether one is registered); throws only real failures.
 */
export async function requestPasswordReset(email: string, cfg: HostConfig = hostConfig()) {
  const { email: address } = forgotPasswordSchema.parse({ email });
  const { error } = await supabase.auth.resetPasswordForEmail(address, {
    redirectTo: passwordResetRedirect(cfg),
  });
  if (error) throw error;
}

/** Sets the new password, then ends the recovery session (sign in again). */
export async function updatePassword(input: { password: string; confirm: string }) {
  const { password } = resetPasswordSchema.parse(input);
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
  clearRecoveryMark();
  // End this browser's recovery session. The password is already changed, so a
  // failure here must not report the change as failed (the local session is
  // removed by supabase-js either way).
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
}
