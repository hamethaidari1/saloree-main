import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { redirect } from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";
import type { AppRole } from "@/data/db";
import { supabase } from "@/lib/supabase";
import { safeReturnTo } from "@/lib/redirects";

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
  return safeReturnTo(value) ?? fallback;
}

export type Access = "allowed" | "login" | "forbidden";

/** Pure access decision: no user → login; missing role → forbidden. */
export function decideAccess(user: User | null, roles: readonly string[], role?: AppRole): Access {
  if (!user) return "login";
  if (role && !roles.includes(role)) return "forbidden";
  return "allowed";
}

/**
 * Route guards for `beforeLoad`. Use with `ssr: false`: the session lives in
 * browser storage, so the server cannot see it. This is UX only — the data
 * itself is protected by RLS. If roles cannot be read, the error propagates
 * (fail closed) instead of granting access.
 */
export function requireAuth(role?: AppRole) {
  return async ({ location }: { location: { href: string } }) => {
    const { user, roles } = await getAuthState();
    const access = decideAccess(user, roles, role);
    if (access === "login" || !user)
      throw redirect({ to: "/login", search: { redirect: location.href } });
    if (access === "forbidden") throw redirect({ to: "/account" });
    return { user, roles };
  };
}

/**
 * Like requireAuth, but a signed-in user without the role stays on the page
 * and the route renders a "not allowed" screen (`allowed: false`).
 */
export function requireRoleOrForbid(role: AppRole) {
  return async ({ location }: { location: { href: string } }) => {
    const { user, roles } = await getAuthState();
    const access = decideAccess(user, roles, role);
    if (access === "login" || !user)
      throw redirect({ to: "/login", search: { redirect: location.href } });
    return { user, roles, allowed: access === "allowed" };
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

/** profiles.full_name (RLS: own row). null if empty or unreadable. */
export async function fetchProfileName(userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  const name = (data as { full_name: string | null } | null)?.full_name?.trim();
  return name || null;
}

interface AuthContextValue {
  user: User | null;
  roles: AppRole[];
  /** From profiles.full_name (also filled for Google sign-ins). */
  fullName: string | null;
  ready: boolean;
  isSeller: boolean;
  isAdmin: boolean;
}
const AuthContext = createContext<AuthContextValue>({
  user: null,
  roles: [],
  fullName: null,
  ready: false,
  isSeller: false,
  isAdmin: false,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [fullName, setFullName] = useState<string | null>(null);
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
        setFullName(null);
        setReady(true);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    Promise.all([
      fetchRoles(userId).catch(() => [] as AppRole[]),
      fetchProfileName(userId).catch(() => null),
    ]).then(([r, name]) => {
      if (cancelled) return;
      setRoles(r);
      setFullName(name);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <AuthContext.Provider
      value={{
        user,
        roles,
        fullName,
        ready,
        isSeller: roles.includes("seller"),
        isAdmin: roles.includes("admin"),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
