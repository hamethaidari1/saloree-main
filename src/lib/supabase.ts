import { createClient } from "@supabase/supabase-js";
import { clearRecoveryMark, isAuthRedirectUrl, markRecovery } from "./auth-url";

const url: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const key: string | undefined = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set.");
}

const isBrowser = typeof window !== "undefined";

// The publishable key is safe in browser code; access is enforced by RLS.
// On the server (SSR loaders) the client never holds a session, so every
// server-side query runs as the anonymous role.
//
// PKCE: OAuth (Google), confirmation and password-reset emails return a
// one-time ?code= that only the browser which asked for it can exchange; the
// client does that automatically when it starts. Error redirects (#error=…)
// are left to /auth/callback and /reset-password, which show them.
export const supabase = createClient(url, key, {
  auth: {
    flowType: "pkce",
    persistSession: isBrowser,
    autoRefreshToken: isBrowser,
    detectSessionInUrl: isBrowser ? isAuthRedirectUrl : false,
  },
});

// Registered before the client finishes processing the URL, so a password
// recovery link is always noticed (/reset-password shows its form only then).
if (isBrowser)
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" && session) markRecovery(session.user.id);
    if (event === "SIGNED_OUT") clearRecoveryMark();
  });
