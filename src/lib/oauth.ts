/**
 * "Continue with Google" (Supabase Auth, PKCE). The pure helpers here decide
 * where a user may be sent and what they asked for; the browser-only parts
 * save that before leaving for Google and finish the sign-in on return.
 *
 * Tokens are never stored or logged here: supabase-js keeps the session.
 */
import { supabase } from "@/lib/supabase";
import { fetchRoles } from "@/lib/auth";
import { homeForRoles, safeReturnTo } from "@/lib/redirects";

export const OAUTH_CALLBACK_PATH = "/auth/callback";
const STORAGE_KEY = "saloree.oauth";

export type OAuthIntent = "customer" | "seller";

export interface SavedOAuth {
  returnTo: string | null;
  intent: OAuthIntent;
}

export function parseSavedOAuth(raw: string | null): SavedOAuth {
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return {
        returnTo: safeReturnTo(o["returnTo"]),
        intent: o["intent"] === "seller" ? "seller" : "customer",
      };
    }
  } catch {
    // Corrupt value: treat as nothing saved.
  }
  return { returnTo: null, intent: "customer" };
}

/** Where to go once signed in. A seller sign-up always goes to the dashboard. */
export function destinationAfterSignIn(saved: SavedOAuth, roles: readonly string[]): string {
  if (saved.intent === "seller") return "/seller";
  return saved.returnTo ?? homeForRoles(roles);
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function saveOAuth(saved: SavedOAuth) {
  storage()?.setItem(
    STORAGE_KEY,
    JSON.stringify({ returnTo: safeReturnTo(saved.returnTo), intent: saved.intent }),
  );
}

/** Reads and clears what was saved before leaving for Google (one use only). */
export function takeSavedOAuth(): SavedOAuth {
  const s = storage();
  const saved = parseSavedOAuth(s?.getItem(STORAGE_KEY) ?? null);
  s?.removeItem(STORAGE_KEY);
  return saved;
}

/** Saves returnTo/intent, then leaves for Google (the page navigates away). */
export async function startGoogleSignIn(saved: SavedOAuth) {
  saveOAuth(saved);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}${OAUTH_CALLBACK_PATH}`,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) {
    storage()?.removeItem(STORAGE_KEY);
    throw error;
  }
}

/** The message of an Error or of a plain { message } object (Supabase returns both). */
export function errorText(e: unknown): string | null {
  if (e && typeof e === "object" && "message" in e) {
    const msg = (e as { message: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return null;
}

/** A sign-in failure with the real message from Google / Supabase. */
export class OAuthCallbackError extends Error {
  constructor(
    message: string,
    /** "signin": no session. "seller": signed in, but become_seller() failed. */
    readonly stage: "signin" | "seller",
    readonly code?: string,
  ) {
    super(message);
    this.name = "OAuthCallbackError";
  }
}

/** The provider's error, if the callback URL carries one (query or #fragment). */
export function errorFromCallbackUrl(href: string): { message: string; code?: string } | null {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  for (const p of [url.searchParams, hash]) {
    const code = p.get("error_code") ?? p.get("error");
    const description = p.get("error_description");
    if (code || description)
      return { message: description ?? code ?? "Sign-in failed.", ...(code ? { code } : {}) };
  }
  return null;
}

/**
 * Finishes the sign-in on /auth/callback: exchanges the PKCE code for a
 * session, applies the seller intent (become_seller RPC) and returns where
 * to go next. Throws OAuthCallbackError with the real message on failure.
 */
export async function completeOAuthSignIn(href: string): Promise<string> {
  const saved = takeSavedOAuth();
  const providerError = errorFromCallbackUrl(href);
  if (providerError)
    throw new OAuthCallbackError(providerError.message, "signin", providerError.code);

  const code = new URL(href).searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw new OAuthCallbackError(error.message, "signin", error.code);
  }
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session)
    throw new OAuthCallbackError(
      "No sign-in was received. The link may have expired or already been used.",
      "signin",
      "no_session",
    );

  if (saved.intent === "seller") {
    const { error } = await supabase.rpc("become_seller");
    if (error) throw new OAuthCallbackError(error.message, "seller", error.code);
  }
  const roles = await fetchRoles(session.user.id);
  return destinationAfterSignIn(saved, roles);
}
