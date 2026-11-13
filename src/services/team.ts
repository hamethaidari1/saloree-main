/**
 * Staff roles (admin only). The database allows only admins to write
 * user_roles and refuses removing your own admin row; the app says so first.
 */
import { z } from "zod";
import type { ProfileRow } from "@/data/db";
import { supabase } from "@/lib/supabase";
import { STAFF_ROLES, type StaffRole } from "@/lib/staff-access";
import { currentUserId } from "./admin";
import { expectRows, NotPermittedError } from "./errors";

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  admin: "Admin (everything)",
  content_admin: "Content admin (marketplace)",
  finance_admin: "Finance admin",
};

export interface StaffMember {
  userId: string;
  name: string | null;
  email: string | null;
  roles: { role: StaffRole; since: string | null }[];
}

export const addStaffSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter the email address the person signed up with."),
  role: z.enum(STAFF_ROLES),
});

/** Groups user_roles rows by person (pure). */
export function groupStaff(
  rows: { user_id: string; role: string; created_at: string | null }[],
  profiles: Pick<ProfileRow, "id" | "full_name" | "email">[],
): StaffMember[] {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const people = new Map<string, StaffMember>();
  for (const r of rows) {
    if (!(STAFF_ROLES as readonly string[]).includes(r.role)) continue;
    const p = byId.get(r.user_id);
    const m = people.get(r.user_id) ?? {
      userId: r.user_id,
      name: p?.full_name ?? null,
      email: p?.email ?? null,
      roles: [],
    };
    m.roles.push({ role: r.role as StaffRole, since: r.created_at });
    people.set(r.user_id, m);
  }
  for (const m of people.values())
    m.roles.sort((a, b) => STAFF_ROLES.indexOf(a.role) - STAFF_ROLES.indexOf(b.role));
  return [...people.values()].sort((a, b) =>
    (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""),
  );
}

/** Escape LIKE wildcards so an email is matched literally. */
const likeLiteral = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class NotRegisteredError extends Error {
  constructor() {
    super("This person must register first.");
    this.name = "NotRegisteredError";
  }
}

export const teamService = {
  listStaff: async (): Promise<StaffMember[]> => {
    const { data, error } = await supabase
      .from("user_roles")
      .select("user_id, role, created_at")
      .in("role", [...STAFF_ROLES]);
    if (error) throw error;
    const rows = data as { user_id: string; role: string; created_at: string | null }[];
    const ids = [...new Set(rows.map((r) => r.user_id))];
    let profiles: Pick<ProfileRow, "id" | "full_name" | "email">[] = [];
    if (ids.length) {
      const res = await supabase.from("profiles").select("id, full_name, email").in("id", ids);
      if (res.error) throw res.error;
      profiles = res.data as typeof profiles;
    }
    return groupStaff(rows, profiles);
  },

  /** Finds a registered person by email (case-insensitive, exact). */
  findByEmail: async (email: string) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .ilike("email", likeLiteral(email.trim()))
      .limit(2);
    if (error) throw error;
    const rows = data as Pick<ProfileRow, "id" | "full_name" | "email">[];
    return rows.find((r) => r.email?.toLowerCase() === email.trim().toLowerCase()) ?? null;
  },

  addRole: async (input: unknown) => {
    const { email, role } = addStaffSchema.parse(input);
    const person = await teamService.findByEmail(email);
    if (!person) throw new NotRegisteredError();
    const { error } = await supabase.from("user_roles").insert({ user_id: person.id, role });
    if (error && (error as { code?: string }).code === "23505")
      throw new Error(`${person.full_name ?? email} already has that role.`);
    if (error) throw error;
    return person;
  },

  removeRole: async (userId: string, role: StaffRole) => {
    if (role === "admin" && userId === (await currentUserId()))
      throw new NotPermittedError("You can't remove your own admin role.");
    const { data, error } = await supabase
      .from("user_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role", role)
      .select("user_id");
    if (error) throw error;
    expectRows(data, "role");
  },
};
