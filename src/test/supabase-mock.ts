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
    uploads: [] as { bucket: string; path: string }[],
    queue: [] as Reply[],
    fallback: { data: [], error: null, count: 0 } as Reply,
    /** Current auth session (null = signed out). */
    session: { user: { id: "user-1" } } as { user: { id: string } } | null,
    oauthCalls: [] as unknown[],
    oauthError: null as { message: string; code?: string } | null,
    exchanges: [] as string[],
    exchangeError: null as { message: string; code?: string } | null,
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
      "update",
      "delete",
      "eq",
      "in",
      "lte",
      "order",
      "limit",
      "like",
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
    state.uploads.length = 0;
    state.queue.length = 0;
    state.fallback = { data: [], error: null, count: 0 };
    state.session = { user: { id: "user-1" } };
    state.oauthCalls.length = 0;
    state.oauthError = null;
    state.exchanges.length = 0;
    state.exchangeError = null;
  };
  /** Calls of the n-th query on `table`. */
  const callsOn = (table: string, n = 0) =>
    state.queries.filter((q) => q.table === table)[n]?.calls ?? [];
  return { supabase, state, reset, callsOn };
}
