/**
 * Server/database errors and form validation → translation keys (errors ns).
 * Known errors get a translated message; unknown ones keep the server's own
 * message (better than a vague "something went wrong").
 */
import type { TFunction } from "i18next";
import type { ZodIssue } from "zod";

type ErrorLike = { code?: unknown; message?: unknown; name?: unknown } | null | undefined;

/** Caller-specific wording for some database codes (keys in the errors ns). */
export type ErrorOverrides = Partial<Record<"42501" | "23505" | "23514", string>>;

/** The errors-ns key for a known error, or null when it isn't one we know. */
export function errorKey(error: unknown, overrides: ErrorOverrides = {}): string | null {
  const e = error as ErrorLike;
  const code = typeof e?.code === "string" ? e.code : "";
  const message = typeof e?.message === "string" ? e.message : "";

  // Postgres / PostgREST
  if (code === "42501" || /row-level security|permission denied/i.test(message))
    return overrides["42501"] ?? "db.permission";
  if (code === "PGRST205" || code === "42P01") return "db.notReady";
  if (code === "23505") return overrides["23505"] ?? "db.duplicate";
  if (code === "23503") return "db.inUse";
  if (code === "23514" && overrides["23514"]) return overrides["23514"];

  // Supabase Auth (error codes first, then the classic messages)
  if (code === "invalid_credentials" || /invalid login credentials/i.test(message))
    return "auth.invalidCredentials";
  if (code === "email_not_confirmed" || /email not confirmed/i.test(message))
    return "auth.emailNotConfirmed";
  if (
    code === "user_already_exists" ||
    code === "email_exists" ||
    /already registered/i.test(message)
  )
    return "auth.alreadyRegistered";
  if (code === "weak_password" || /password should be/i.test(message)) return "auth.weakPassword";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit")
    return "auth.rateLimited";
  if (/provider is not enabled/i.test(message)) return "auth.providerDisabled";
  if (code === "access_denied") return "auth.userDenied";

  // Browser network failure
  if (/failed to fetch|networkerror|load failed/i.test(message)) return "db.network";
  return null;
}

/** Translated message for an error (raw server message for unknown errors). */
export function translateError(
  t: TFunction,
  error: unknown,
  overrides: ErrorOverrides = {},
): string {
  const key = errorKey(error, overrides);
  if (key) return t(key, { ns: "errors" });
  const message = (error as ErrorLike)?.message;
  return typeof message === "string" && message.trim() ? message : t("generic", { ns: "errors" });
}

/** Which kind of problem a zod issue is, independent of its English message. */
export function issueKind(issue: Pick<ZodIssue, "code"> & Record<string, unknown>) {
  switch (issue.code) {
    case "invalid_type":
      return "required";
    case "too_small":
      return Number(issue["minimum"]) <= 1 ? "required" : "tooShort";
    case "too_big":
      return "tooLong";
    default:
      return "invalid";
  }
}

/**
 * errors:validation.<field>.<kind>, falling back to a generic "check this field".
 * An empty value is always "required" (not "too short").
 */
export function validationMessage(
  t: TFunction,
  field: string,
  issue: ZodIssue,
  value?: unknown,
): string {
  const empty = typeof value === "string" && value.trim() === "";
  const kind = empty ? "required" : issueKind(issue as ZodIssue & Record<string, unknown>);
  return t(`validation.${field}.${kind}`, {
    ns: "errors",
    defaultValue: t("validation.fallback", { ns: "errors" }),
  });
}
