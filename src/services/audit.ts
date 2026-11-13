/**
 * Audit log (admin only, read only). Rows are written by database triggers
 * for every staff change; the app never writes them.
 */
import type { ProfileRow } from "@/data/db";
import { supabase } from "@/lib/supabase";

export const AUDIT_PAGE_SIZE = 50;

/** Tables the audit triggers watch (for the filter). */
export const AUDITED_TABLES = [
  "stores",
  "products",
  "categories",
  "user_roles",
  "platform_settings",
  "carriers",
  "store_templates",
  "store_template_grants",
  "site_settings",
  "footer_links",
  "hero_slides",
  "promo_banners",
  "homepage_sections",
] as const;

export interface AuditRow {
  id: number;
  actor_id: string | null;
  actor_roles: string[] | null;
  table_name: string;
  row_id: string | null;
  action: "INSERT" | "UPDATE" | "DELETE";
  changes: unknown;
  created_at: string;
}

export interface AuditEntry extends AuditRow {
  actor: { name: string | null; email: string | null } | null;
}

export interface AuditFilter {
  actorId: string;
  table: string;
  /** yyyy-mm-dd, inclusive (local days). */
  from: string;
  to: string;
}
export const EMPTY_AUDIT_FILTER: AuditFilter = { actorId: "", table: "", from: "", to: "" };

/** Local-day bounds as ISO instants: [from 00:00, day after `to` 00:00). */
export function dayRange(from: string, to: string): { gte?: string; lt?: string } {
  const out: { gte?: string; lt?: string } = {};
  if (from) out.gte = new Date(`${from}T00:00:00`).toISOString();
  if (to) {
    const end = new Date(`${to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    out.lt = end.toISOString();
  }
  return out;
}

export const MAX_VALUE_CHARS = 80;

/** A value for display: strings as-is, the rest as JSON; long ones truncated. */
export function formatValue(v: unknown, max = MAX_VALUE_CHARS): string {
  if (v === undefined) return "—";
  if (v === null) return "empty";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export interface ChangeLine {
  field: string;
  before: string;
  after: string;
}

/**
 * Readable lines from `changes`. UPDATE: { col: { old, new } } → before → after.
 * INSERT: the new row (before is "—"). DELETE: the removed row (after is "—").
 */
export function describeChanges(action: AuditRow["action"], changes: unknown): ChangeLine[] {
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) return [];
  const entries = Object.entries(changes as Record<string, unknown>);
  if (action === "UPDATE")
    return entries.map(([field, v]) => {
      const pair = (v && typeof v === "object" ? v : {}) as { old?: unknown; new?: unknown };
      return { field, before: formatValue(pair.old), after: formatValue(pair.new) };
    });
  return entries.map(([field, v]) =>
    action === "INSERT"
      ? { field, before: "—", after: formatValue(v) }
      : { field, before: formatValue(v), after: "—" },
  );
}

export const auditService = {
  list: async (
    page: number,
    filter: AuditFilter,
  ): Promise<{ rows: AuditEntry[]; total: number }> => {
    let q = supabase
      .from("audit_log")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });
    if (filter.actorId) q = q.eq("actor_id", filter.actorId);
    if (filter.table) q = q.eq("table_name", filter.table);
    const { gte, lt } = dayRange(filter.from, filter.to);
    if (gte) q = q.gte("created_at", gte);
    if (lt) q = q.lt("created_at", lt);
    const start = page * AUDIT_PAGE_SIZE;
    const { data, error, count } = await q.range(start, start + AUDIT_PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data as AuditRow[];
    const ids = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x))];
    const people = new Map<string, Pick<ProfileRow, "full_name" | "email">>();
    if (ids.length) {
      const res = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
      if (res.error) throw res.error;
      for (const p of res.data as Pick<ProfileRow, "id" | "full_name" | "email">[])
        people.set(p.id, p);
    }
    return {
      rows: rows.map((r) => {
        const p = r.actor_id ? people.get(r.actor_id) : undefined;
        return { ...r, actor: p ? { name: p.full_name, email: p.email } : null };
      }),
      total: count ?? rows.length,
    };
  },
};
