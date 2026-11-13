/** Pure helpers for "where do we send the user after sign-in?" (no I/O). */
import { staffHome } from "./staff-access";

/**
 * The one check for redirect targets (?redirect=, saved returnTo).
 * Only a same-site relative path: starts with exactly one "/", no "//",
 * no backslashes, no whitespace or control characters, no scheme.
 * Returns the path, or null when it isn't safe.
 */
export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  // Browsers drop tabs/newlines in URLs ("/\t/evil.com" → "//evil.com").
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(value)) return null;
  // Resolve against a dummy origin: anything that leaves it is rejected.
  try {
    if (new URL(value, "https://saloree.invalid").origin !== "https://saloree.invalid") return null;
  } catch {
    return null;
  }
  return value;
}

/** Staff go to their own panel (see staff-access), then sellers, else /account. */
export function homeForRoles(roles: readonly string[]): string {
  return staffHome(roles) ?? (roles.includes("seller") ? "/seller" : "/account");
}
