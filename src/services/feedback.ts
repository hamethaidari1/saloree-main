/**
 * Site feedback: visitors send it through submit_site_feedback (anon key);
 * staff (admin, content_admin) read site_feedback and change its status
 * through mark_site_feedback. No table is ever written directly.
 *
 * Sent: the message, an optional e-mail, the page's pathname (no query
 * string or hash) and the language. Nothing else.
 */
import { z } from "zod";
import { isLocale, type Locale } from "@/i18n/locales";
import { pathOnly } from "@/lib/side-widget";
import { supabase } from "@/lib/supabase";

export const FEEDBACK_MIN = 3;
export const FEEDBACK_MAX = 2000;
export const FEEDBACK_PAGE_SIZE = 25;

/** Codes, so the dialog shows them in the visitor's language. */
export type FeedbackIssue = "tooShort" | "tooLong" | "badEmail";

export const feedbackInputSchema = z.object({
  message: z.string().trim().min(FEEDBACK_MIN, "tooShort").max(FEEDBACK_MAX, "tooLong"),
  email: z
    .string()
    .trim()
    .max(254, "badEmail")
    .refine((v) => v === "" || z.string().email().safeParse(v).success, "badEmail")
    .transform((v) => v || null),
  path: z.string().transform(pathOnly),
  locale: z
    .string()
    .refine(isLocale)
    .transform((v) => v as Locale),
});
export type FeedbackInput = z.input<typeof feedbackInputSchema>;

export type FeedbackIssues = Partial<Record<"message" | "email", FeedbackIssue | undefined>>;

/** Field → issue code, or {} when valid. */
export function feedbackIssues(input: FeedbackInput): FeedbackIssues {
  const r = feedbackInputSchema.safeParse(input);
  if (r.success) return {};
  const out: FeedbackIssues = {};
  for (const i of r.error.issues) {
    const f = i.path[0];
    if ((f === "message" || f === "email") && !out[f]) out[f] = i.message as FeedbackIssue;
  }
  return out;
}

/** The exact RPC arguments: nothing beyond these four. */
export const submitFeedbackArgsSchema = z
  .object({
    p_message: z.string().min(FEEDBACK_MIN).max(FEEDBACK_MAX),
    p_email: z.string().email().nullable(),
    p_path: z.string().regex(/^\/[^?#]*$/),
    p_locale: z.string(),
  })
  .strict();

export function toSubmitArgs(input: FeedbackInput) {
  const v = feedbackInputSchema.parse(input);
  return submitFeedbackArgsSchema.parse({
    p_message: v.message,
    p_email: v.email,
    p_path: v.path,
    p_locale: v.locale,
  });
}

/** A database error: its own message and code only (never details/hint). */
export class FeedbackDbError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "FeedbackDbError";
  }
}
const dbError = (e: { message?: string; code?: string } | null) =>
  new FeedbackDbError(e?.message || "The request was refused.", e?.code ?? null);

/** "message (code)", for staff screens. */
export function feedbackErrorText(e: unknown): string {
  const o = (e ?? {}) as { message?: unknown; code?: unknown };
  const message = typeof o.message === "string" ? o.message : "";
  if (!message) return "Something went wrong. Please try again.";
  return typeof o.code === "string" && o.code ? `${message} (${o.code})` : message;
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
export const FEEDBACK_STATUSES = ["new", "read", "archived"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

const nstr = z
  .string()
  .nullish()
  .transform((v) => v ?? null);
export const feedbackRowSchema = z.object({
  id: z.string(),
  user_id: nstr,
  contact_email: nstr,
  message: z.string(),
  page_path: nstr,
  locale: nstr,
  status: z.enum(FEEDBACK_STATUSES),
  handled_by: nstr,
  handled_at: nstr,
  created_at: z.string(),
});
export type FeedbackRow = z.output<typeof feedbackRowSchema>;

function parseRows(data: unknown): FeedbackRow[] {
  const r = z.array(feedbackRowSchema).safeParse(data ?? []);
  if (!r.success) {
    const fields = [...new Set(r.error.issues.map((i) => i.path.slice(1).join(".")))].join(", ");
    throw new Error(`site_feedback has unexpected values (${fields}).`);
  }
  return r.data;
}

export const feedbackService = {
  /** Visitors (anon or signed in). The database sets the user and the time. */
  submit: async (input: FeedbackInput): Promise<void> => {
    const { error } = await supabase.rpc("submit_site_feedback", toSubmitArgs(input));
    if (error) throw dbError(error);
  },

  /** One page, newest first. */
  list: async (
    status: FeedbackStatus,
    page: number,
  ): Promise<{ rows: FeedbackRow[]; hasMore: boolean }> => {
    const from = page * FEEDBACK_PAGE_SIZE;
    const { data, error } = await supabase
      .from("site_feedback")
      .select("*")
      .eq("status", status)
      .order("created_at", { ascending: false })
      .range(from, from + FEEDBACK_PAGE_SIZE); // one extra row tells whether more exist
    if (error) throw dbError(error);
    const rows = parseRows(data);
    return { rows: rows.slice(0, FEEDBACK_PAGE_SIZE), hasMore: rows.length > FEEDBACK_PAGE_SIZE };
  },

  counts: async (): Promise<Record<FeedbackStatus, number>> => {
    const results = await Promise.all(
      FEEDBACK_STATUSES.map((s) =>
        supabase.from("site_feedback").select("id", { count: "exact", head: true }).eq("status", s),
      ),
    );
    const out = { new: 0, read: 0, archived: 0 } as Record<FeedbackStatus, number>;
    results.forEach((r, i) => {
      if (r.error) throw dbError(r.error);
      out[FEEDBACK_STATUSES[i]!] = r.count ?? 0;
    });
    return out;
  },

  mark: async (id: string, status: FeedbackStatus): Promise<void> => {
    const args = z
      .object({ p_id: z.string().uuid(), p_status: z.enum(FEEDBACK_STATUSES) })
      .parse({ p_id: id, p_status: status });
    const { error } = await supabase.rpc("mark_site_feedback", args);
    if (error) throw dbError(error);
  },
};

export const feedbackKeys = {
  all: ["admin", "feedback"] as const,
  list: (status: FeedbackStatus) => ["admin", "feedback", "list", status] as const,
  counts: ["admin", "feedback", "counts"] as const,
};
