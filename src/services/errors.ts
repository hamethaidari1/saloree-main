/** Postgres/PostgREST error codes the app reacts to. */
type Overrides = Partial<Record<"23505" | "23503" | "23514" | "42501" | "PGRST205", string>>;

const DEFAULTS: Required<Omit<Overrides, "23514">> = {
  "23505": "That slug is already taken. Try a different one.",
  "23503": "This product is part of existing orders. Set it to draft instead of deleting it.",
  "42501": "You don't have permission to do that.",
  PGRST205: "This feature needs a database update that hasn't been applied yet.",
};

/** Turns Supabase/Postgres errors into messages people can act on. */
export function friendlyError(error: unknown, overrides: Overrides = {}): string {
  const e = error as { code?: string; message?: string } | null;
  const messages = { ...DEFAULTS, ...overrides };
  if (e?.code === "23505") return messages["23505"];
  if (e?.code === "23503") return messages["23503"];
  // Check-constraint violation: use the caller's wording, else the database's own message.
  if (e?.code === "23514" && messages["23514"]) return messages["23514"];
  if (e?.code === "PGRST205" || e?.code === "42P01") return messages.PGRST205;
  if (e?.code === "42501" || /row-level security|permission denied/i.test(e?.message ?? ""))
    return messages["42501"];
  return e?.message || "Something went wrong. Please try again.";
}

export class NotPermittedError extends Error {
  code = "42501";
}

/** An update/delete blocked by RLS returns no error and zero rows — treat that as a failure. */
export function expectRows<T>(data: T[] | null, what: string): T {
  const row = data?.[0];
  if (!row) throw new NotPermittedError(`You don't have permission to change this ${what}.`);
  return row;
}
