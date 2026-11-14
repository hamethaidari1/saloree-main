import { vi } from "vitest";

/** One recorded call on the fake query builder, e.g. ["eq", "id", "x"]. */
export type Call = [method: string, ...args: unknown[]];
export interface Recorded {
  table: string;
  calls: Call[];
}
export interface Reply {
  data?: unknown;
  error?: unknown;
  count?: number | null;
}

/**
 * Minimal chainable stand-in for the Supabase client. Every builder records
 * its calls; replies are taken from `queue` (first in, first out) or `fallback`.
 */
export function createSupabaseMock() {
  const state = {
    queries: [] as Recorded[],
    rpcs: [] as { fn: string; args: unknown }[],
    /** Edge Function calls (supabase.functions.invoke). */
    invokes: [] as { name: string; body: unknown }[],
    uploads: [] as { bucket: string; path: string }[],
    queue: [] as Reply[],
    fallback: { data: [], error: null, count: 0 } as Reply,
    /** Current auth session (null = signed out). */
    session: { user: { id: "user-1" } } as {
      user: { id: string; email?: string };
      access_token?: string;
    } | null,
    oauthCalls: [] as unknown[],
    oauthError: null as { message: string; code?: string } | null,
    exchanges: [] as string[],
    exchangeError: null as { message: string; code?: string } | null,
    /** Auth calls by name, with their arguments (password reset etc.). */
    authCalls: [] as { fn: string; args: unknown[] }[],
    /** Next error per auth method name (taken once). */
    authErrors: {} as Record<string, unknown>,
    /** What `initialize()` reports (the client's own processing of the URL). */
    initError: null as unknown,
    /** Auth events the next initialize()/verifyOtp() emits to listeners. */
    listeners: new Set<(event: string, session: unknown) => void>(),
  };
  const authCall = (fn: string, ...args: unknown[]) => {
    state.authCalls.push({ fn, args });
    const error = state.authErrors[fn] ?? null;
    delete state.authErrors[fn];
    return error;
  };
  const emit = (event: string) => {
    for (const l of state.listeners) l(event, state.session);
  };
  const reply = () => {
    const r = state.queue.shift() ?? state.fallback;
    return { data: r.data ?? null, error: r.error ?? null, count: r.count ?? null };
  };
  const from = (table: string) => {
    const rec: Recorded = { table, calls: [] };
    state.queries.push(rec);
    let result: ReturnType<typeof reply> | undefined;
    const settle = () => (result ??= reply());
    const builder: Record<string, unknown> = {};
    for (const m of [
      "select",
      "insert",
      "upsert",
      "update",
      "delete",
      "eq",
      "in",
      "lte",
      "order",
      "limit",
      "like",
      "ilike",
      "gte",
      "lt",
      "range",
    ])
      builder[m] = (...args: unknown[]) => {
        rec.calls.push([m, ...args]);
        return builder;
      };
    builder["single"] = async () => settle();
    builder["maybeSingle"] = async () => settle();
    builder["then"] = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) =>
      Promise.resolve(settle()).then(ok, fail);
    return builder;
  };
  const supabase = {
    from: vi.fn(from),
    rpc: vi.fn(async (fn: string, args?: unknown) => {
      state.rpcs.push({ fn, args });
      return reply();
    }),
    auth: {
      getUser: async () => ({ data: { user: state.session?.user ?? null } }),
      getSession: async () => ({ data: { session: state.session } }),
      signInWithOAuth: vi.fn(async (args: unknown) => {
        state.oauthCalls.push(args);
        return { data: { url: null }, error: state.oauthError };
      }),
      exchangeCodeForSession: vi.fn(async (code: string) => {
        state.exchanges.push(code);
        if (state.exchangeError) {
          state.session = null;
          return { data: { session: null }, error: state.exchangeError };
        }
        return { data: { session: state.session }, error: null };
      }),
      initialize: vi.fn(async () => {
        authCall("initialize");
        return { error: state.initError };
      }),
      onAuthStateChange: vi.fn((cb: (event: string, session: unknown) => void) => {
        state.listeners.add(cb);
        return { data: { subscription: { unsubscribe: () => state.listeners.delete(cb) } } };
      }),
      resetPasswordForEmail: vi.fn(async (email: string, options?: unknown) => {
        const error = authCall("resetPasswordForEmail", email, options);
        return { data: {}, error };
      }),
      verifyOtp: vi.fn(async (params: unknown) => {
        const error = authCall("verifyOtp", params);
        if (!error) emit("PASSWORD_RECOVERY");
        return { data: { session: error ? null : state.session }, error };
      }),
      updateUser: vi.fn(async (attrs: unknown) => {
        const error = authCall("updateUser", attrs);
        return { data: { user: error ? null : state.session?.user }, error };
      }),
      signOut: vi.fn(async (options?: unknown) => {
        const error = authCall("signOut", options);
        if (!error) {
          state.session = null;
          emit("SIGNED_OUT");
        }
        return { error };
      }),
    },
    functions: {
      invoke: vi.fn(async (name: string, options?: { body?: unknown }) => {
        state.invokes.push({ name, body: options?.body });
        const r = reply();
        return { data: r.data, error: r.error };
      }),
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          state.uploads.push({ bucket, path });
          return { error: null };
        },
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/${bucket}/${path}` },
        }),
        remove: async () => ({ error: null }),
      }),
    },
  };
  const reset = () => {
    state.queries.length = 0;
    state.rpcs.length = 0;
    state.invokes.length = 0;
    state.uploads.length = 0;
    state.queue.length = 0;
    state.fallback = { data: [], error: null, count: 0 };
    state.session = { user: { id: "user-1" } };
    state.oauthCalls.length = 0;
    state.oauthError = null;
    state.exchanges.length = 0;
    state.exchangeError = null;
    state.authCalls.length = 0;
    state.authErrors = {};
    state.initError = null;
    state.listeners.clear();
  };
  /** Calls of the n-th query on `table`. */
  const callsOn = (table: string, n = 0) =>
    state.queries.filter((q) => q.table === table)[n]?.calls ?? [];
  return { supabase, state, reset, callsOn };
}
