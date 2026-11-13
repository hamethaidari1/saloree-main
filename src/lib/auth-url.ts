/**
 * Which URLs supabase-js should treat as an auth redirect when it starts.
 * Kept apart from `supabase.ts` so it can be tested without a client.
 */

// ---------------------------------------------------------------------------
// "This tab opened a password-recovery link for user X." Set by the client's
// PASSWORD_RECOVERY listener (registered in supabase.ts before the link is
// processed, so the event is never missed); read by /reset-password.
// ---------------------------------------------------------------------------
const RECOVERY_KEY = "saloree.recovery-user";
const tabStorage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
};
export function markRecovery(userId: string) {
  try {
    tabStorage()?.setItem(RECOVERY_KEY, userId);
  } catch {
    // Storage blocked: the page falls back to the session's own auth method.
  }
}
export function clearRecoveryMark() {
  try {
    tabStorage()?.removeItem(RECOVERY_KEY);
  } catch {
    // ignore
  }
}
export function hasRecoveryMark(userId: string) {
  try {
    return tabStorage()?.getItem(RECOVERY_KEY) === userId;
  } catch {
    return false;
  }
}

/** Pages that read their own implicit/error parameters (to show the real error). */
export const SELF_HANDLED_AUTH_PATHS = ["/auth/callback", "/reset-password"] as const;

/**
 * `detectSessionInUrl` for the client. The page is skipped when it handles the
 * link itself; otherwise only a real implicit/error redirect counts. PKCE
 * `?code=` links are detected separately by supabase-js. (Returning `true` for
 * every URL made each page load look like a failed redirect, so codes on other
 * pages were never exchanged.)
 */
export function isAuthRedirectUrl(url: URL, params: Record<string, string>): boolean {
  if ((SELF_HANDLED_AUTH_PATHS as readonly string[]).includes(url.pathname)) return false;
  return Boolean(
    params["access_token"] ||
    params["error"] ||
    params["error_description"] ||
    params["error_code"],
  );
}
