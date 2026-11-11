import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { redirect } from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";
import type { AppRole } from "@/data/db";
import { supabase } from "@/lib/supabase";

export type SignupRole = "customer" | "seller";

/** Roles come from public.user_roles (RLS: a user may read only their own rows). */
export async function fetchRoles(userId: string): Promise<AppRole[]> {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((r) => r.role as AppRole);
}

export async function getAuthState(): Promise<{ user: User | null; roles: AppRole[] }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { user: null, roles: [] };
  return { user: session.user, roles: await fetchRoles(session.user.id) };
}

/** Only same-origin paths, so ?redirect= cannot send users to another site. */
export function safeRedirect(value: unknown, fallback = "/") {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : fallback;
}

/**
 * Route guard for `beforeLoad`. Use with `ssr: false`: the session lives in
 * browser storage, so the server cannot see it. This is UX only — the data
 * itself is protected by RLS.
 */
export function requireAuth(role?: AppRole) {
  return async ({ location }: { location: { href: string } }) => {
    const { user, roles } = await getAuthState();
    if (!user) throw redirect({ to: "/login", search: { redirect: location.href } });
    if (role && !roles.includes(role)) throw redirect({ to: "/account" });
    return { user, roles };
  };
}

export async function signUp(input: {
  email: string;
  password: string;
  fullName: string;
  role: SignupRole;
}) {
  // `role` is a request only: the handle_new_user trigger must whitelist it
  // (customer | seller) — never trust user_metadata for authorization.
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { full_name: input.fullName, role: input.role },
      emailRedirectTo: `${window.location.origin}/login`,
    },
  });
  if (error) throw error;
  return { needsConfirmation: !data.session };
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { user: data.user, roles: await fetchRoles(data.user.id) };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

interface AuthContextValue {
  user: User | null;
  roles: AppRole[];
  ready: boolean;
  isSeller: boolean;
}
const AuthContext = createContext<AuthContextValue>({
  user: null,
  roles: [],
  ready: false,
  isSeller: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [ready, setReady] = useState(false);
  const userId = user?.id;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      if (!data.session) setReady(true);
    });
    // Keep this callback synchronous: awaiting Supabase calls inside it can deadlock the client.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (!session) {
        setRoles([]);
        setReady(true);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    fetchRoles(userId)
      .catch(() => [] as AppRole[])
      .then((r) => {
        if (cancelled) return;
        setRoles(r);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <AuthContext.Provider value={{ user, roles, ready, isSeller: roles.includes("seller") }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
