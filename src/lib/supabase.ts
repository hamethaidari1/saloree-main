import { createClient } from "@supabase/supabase-js";

const url: string | undefined = import.meta.env.VITE_SUPABASE_URL;
const key: string | undefined = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be set.");
}

const isBrowser = typeof window !== "undefined";

// The publishable key is safe in browser code; access is enforced by RLS.
// On the server (SSR loaders) the client never holds a session, so every
// server-side query runs as the anonymous role.
export const supabase = createClient(url, key, {
  auth: {
    persistSession: isBrowser,
    autoRefreshToken: isBrowser,
    detectSessionInUrl: isBrowser,
  },
});
