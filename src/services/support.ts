/**
 * Support chat between users (buyers, sellers) and the Saloree team.
 *
 * Reads: support_threads / support_messages (RLS: the owner and staff).
 * Writes: ONLY the RPCs start_support_thread, send_support_message,
 * mark_support_thread_read, set_support_thread_status.
 * Live: Supabase Realtime postgres_changes, plus a fetch on every
 * (re)subscription, so nothing sent during a gap is missed.
 *
 * Privacy: message bodies are never logged or put in an error message;
 * errors carry only the database's message and code.
 */
import { z } from "zod";
import { optimizeImage } from "@/lib/image-optimize";
import { supabase } from "@/lib/supabase";
import {
  ATTACHMENT_MIME_TYPES,
  ATTACHMENTS_BUCKET,
  attachmentPath,
  attachmentProblem,
  MESSAGE_MAX,
  SENDER_ROLES,
  SUBJECT_MAX,
  SUBJECT_MIN,
  SUPPORT_TOPICS,
  THREAD_STATUSES,
  type AttachmentMime,
  type SupportTopic,
  type ThreadStatus,
} from "@/lib/support";

export class SupportDbError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "SupportDbError";
  }
}
const dbError = (e: { message?: string; code?: string } | null | undefined) =>
  new SupportDbError(e?.message || "The request was refused.", e?.code ?? null);

/** "message (code)"; reads only message and code (never details/hint). */
export function supportErrorText(e: unknown): string {
  const o = (e ?? {}) as { message?: unknown; code?: unknown };
  const message = typeof o.message === "string" ? o.message : "";
  if (!message) return "Something went wrong. Please try again.";
  return typeof o.code === "string" && o.code ? `${message} (${o.code})` : message;
}

function parse<T extends z.ZodTypeAny>(schema: T, data: unknown, what: string): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    // Field names only: never the values (they may be message text).
    const fields = [...new Set(r.error.issues.map((i) => i.path.join(".") || "(root)"))].join(", ");
    throw new Error(`${what} has unexpected values (${fields}).`);
  }
  return r.data;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------
const nstr = z
  .string()
  .nullish()
  .transform((v) => v ?? null);

export const threadSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  topic: z.enum(SUPPORT_TOPICS),
  subject: z.string(),
  order_id: nstr,
  status: z.enum(THREAD_STATUSES),
  last_message_at: nstr,
  last_sender_role: z
    .enum(SENDER_ROLES)
    .nullish()
    .transform((v) => v ?? null),
  user_last_read_at: nstr,
  staff_last_read_at: nstr,
  closed_by: nstr,
  closed_at: nstr,
  created_at: z.string(),
});
export type SupportThread = z.output<typeof threadSchema>;

export const messageSchema = z.object({
  id: z.string(),
  thread_id: z.string(),
  sender_id: nstr,
  sender_role: z.enum(SENDER_ROLES),
  body: z
    .string()
    .nullish()
    .transform((v) => v ?? ""),
  attachment_path: nstr,
  attachment_mime: z
    .enum(ATTACHMENT_MIME_TYPES)
    .nullish()
    .transform((v) => v ?? null),
  created_at: z.string(),
});
export type SupportMessage = z.output<typeof messageSchema>;

export const unreadCountsSchema = z.preprocess(
  (v) => (Array.isArray(v) ? v[0] : v),
  z.object({
    mine: z.coerce.number().int().nonnegative(),
    staff: z.coerce.number().int().nonnegative(),
  }),
);
export type UnreadCounts = z.output<typeof unreadCountsSchema>;

// ---------------------------------------------------------------------------
// Payloads (exactly the RPC arguments)
// ---------------------------------------------------------------------------
export type FormIssue = "subjectShort" | "subjectLong" | "messageEmpty" | "messageLong";

export const startThreadArgsSchema = z
  .object({
    p_topic: z.enum(SUPPORT_TOPICS),
    p_subject: z.string().trim().min(SUBJECT_MIN, "subjectShort").max(SUBJECT_MAX, "subjectLong"),
    p_body: z.string().trim().min(1, "messageEmpty").max(MESSAGE_MAX, "messageLong"),
    p_order_id: z.string().uuid().nullable(),
  })
  .strict();
export type StartThreadArgs = z.output<typeof startThreadArgsSchema>;

export const sendMessageArgsSchema = z
  .object({
    p_thread_id: z.string().uuid(),
    p_body: z.string().max(MESSAGE_MAX, "messageLong"),
    p_attachment_path: z.string().nullable(),
    p_attachment_mime: z.enum(ATTACHMENT_MIME_TYPES).nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.p_body.trim() && !v.p_attachment_path)
      ctx.addIssue({ code: "custom", path: ["p_body"], message: "messageEmpty" });
    if (!!v.p_attachment_path !== !!v.p_attachment_mime)
      ctx.addIssue({ code: "custom", path: ["p_attachment_mime"], message: "fileType" });
    if (v.p_attachment_path && !v.p_attachment_path.startsWith(`${v.p_thread_id}/`))
      ctx.addIssue({ code: "custom", path: ["p_attachment_path"], message: "fileType" });
  });

/** New-conversation form → issue codes (shown in the visitor's language). */
export function startThreadIssues(input: {
  topic: SupportTopic;
  subject: string;
  body: string;
  orderId: string | null;
}): Partial<Record<"subject" | "body", FormIssue>> {
  const r = startThreadArgsSchema.safeParse({
    p_topic: input.topic,
    p_subject: input.subject,
    p_body: input.body,
    p_order_id: input.orderId,
  });
  if (r.success) return {};
  const out: Partial<Record<"subject" | "body", FormIssue>> = {};
  for (const i of r.error.issues) {
    if (i.path[0] === "p_subject") out.subject ??= i.message as FormIssue;
    if (i.path[0] === "p_body") out.body ??= i.message as FormIssue;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
const THREADS = "support_threads";
const MESSAGES = "support_messages";
export const SIGNED_URL_SECONDS = 60;

export interface LastMessage {
  body: string;
  hasImage: boolean;
  sender_role: SupportMessage["sender_role"];
}

export const supportService = {
  /** The signed-in user's threads (RLS returns only their own). */
  myThreads: async (userId: string): Promise<SupportThread[]> => {
    const { data, error } = await supabase
      .from(THREADS)
      .select("*")
      .eq("user_id", userId)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (error) throw dbError(error);
    return parse(z.array(threadSchema), data ?? [], THREADS);
  },

  /** Staff: every thread (open, closed or both). */
  allThreads: async (status: ThreadStatus | "all"): Promise<SupportThread[]> => {
    let q = supabase.from(THREADS).select("*");
    if (status !== "all") q = q.eq("status", status);
    const { data, error } = await q
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(500);
    if (error) throw dbError(error);
    return parse(z.array(threadSchema), data ?? [], THREADS);
  },

  thread: async (id: string): Promise<SupportThread> => {
    const { data, error } = await supabase.from(THREADS).select("*").eq("id", id).maybeSingle();
    if (error) throw dbError(error);
    if (!data) throw new SupportDbError("This conversation was not found.", "PGRST116");
    return parse(threadSchema, data, THREADS);
  },

  messages: async (threadId: string): Promise<SupportMessage[]> => {
    const { data, error } = await supabase
      .from(MESSAGES)
      .select("*")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: true })
      .limit(1000);
    if (error) throw dbError(error);
    return parse(z.array(messageSchema), data ?? [], MESSAGES);
  },

  /** The latest message of each thread, for the list's preview line. */
  lastMessages: async (threadIds: string[]): Promise<Map<string, LastMessage>> => {
    const map = new Map<string, LastMessage>();
    if (!threadIds.length) return map;
    const { data, error } = await supabase
      .from(MESSAGES)
      .select("thread_id, body, attachment_path, sender_role, created_at")
      .in("thread_id", threadIds)
      .order("created_at", { ascending: false })
      .limit(Math.min(1000, threadIds.length * 20));
    if (error) throw dbError(error);
    const rows = parse(
      z.array(
        z.object({
          thread_id: z.string(),
          body: nstr,
          attachment_path: nstr,
          sender_role: z.enum(SENDER_ROLES),
        }),
      ),
      data ?? [],
      MESSAGES,
    );
    for (const r of rows)
      if (!map.has(r.thread_id))
        map.set(r.thread_id, {
          body: r.body ?? "",
          hasImage: !!r.attachment_path,
          sender_role: r.sender_role,
        });
    return map;
  },

  startThread: async (input: {
    topic: SupportTopic;
    subject: string;
    body: string;
    orderId: string | null;
  }): Promise<string> => {
    const args = parse(
      startThreadArgsSchema,
      {
        p_topic: input.topic,
        p_subject: input.subject,
        p_body: input.body,
        p_order_id: input.orderId,
      },
      "The new conversation",
    );
    const { data, error } = await supabase.rpc("start_support_thread", args);
    if (error) throw dbError(error);
    return parse(z.string().uuid(), Array.isArray(data) ? data[0] : data, "start_support_thread");
  },

  /** Uploads one image to `<thread_id>/<uuid>-<safe-name>`; returns its path. */
  uploadAttachment: async (
    threadId: string,
    file: File,
  ): Promise<{ path: string; mime: AttachmentMime }> => {
    // The picked file's type is checked first (size: the shrunk file, below).
    const picked = attachmentProblem({ name: file.name, type: file.type, size: 1 });
    if (picked) throw new SupportDbError(picked, null);
    // Shrunk to at most 1920 px, WebP (or JPEG), metadata removed, before upload.
    const img = await optimizeImage(file, "attachment");
    const base = file.name.replace(/\.[^.]*$/, "") || "photo";
    const shrunk = new File([img.main], `${base}.${img.ext}`, { type: img.mime });
    const problem = attachmentProblem(shrunk);
    if (problem) throw new SupportDbError(problem, null);
    const path = attachmentPath(threadId, shrunk.name, crypto.randomUUID());
    const { error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(path, shrunk, { contentType: shrunk.type, upsert: false });
    if (error) throw dbError(error as { message?: string });
    return { path, mime: shrunk.type as AttachmentMime };
  },

  sendMessage: async (input: {
    threadId: string;
    body: string;
    attachment: { path: string; mime: AttachmentMime } | null;
  }): Promise<string> => {
    const args = parse(
      sendMessageArgsSchema,
      {
        p_thread_id: input.threadId,
        p_body: input.body.trim(),
        p_attachment_path: input.attachment?.path ?? null,
        p_attachment_mime: input.attachment?.mime ?? null,
      },
      "The message",
    );
    const { data, error } = await supabase.rpc("send_support_message", args);
    if (error) throw dbError(error);
    return parse(z.string().uuid(), Array.isArray(data) ? data[0] : data, "send_support_message");
  },

  markRead: async (threadId: string): Promise<void> => {
    const { error } = await supabase.rpc("mark_support_thread_read", {
      p_thread_id: parse(z.string().uuid(), threadId, "The conversation"),
    });
    if (error) throw dbError(error);
  },

  setStatus: async (threadId: string, status: ThreadStatus): Promise<void> => {
    const { error } = await supabase.rpc("set_support_thread_status", {
      p_thread_id: parse(z.string().uuid(), threadId, "The conversation"),
      p_status: z.enum(THREAD_STATUSES).parse(status),
    });
    if (error) throw dbError(error);
  },

  unreadCounts: async (): Promise<UnreadCounts> => {
    const { data, error } = await supabase.rpc("support_unread_counts");
    if (error) throw dbError(error);
    return parse(unreadCountsSchema, data, "support_unread_counts");
  },

  /** A 60-second link to an attachment, created when it is shown. */
  attachmentUrl: async (path: string): Promise<string> => {
    const { data, error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(path, SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) throw dbError(error as { message?: string } | null);
    return data.signedUrl;
  },

  /** Staff: names and e-mails of these users, where profiles are readable (else none). */
  people: async (
    userIds: string[],
  ): Promise<Map<string, { name: string | null; email: string | null }>> => {
    const map = new Map<string, { name: string | null; email: string | null }>();
    if (!userIds.length) return map;
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds);
    if (error || !Array.isArray(data)) return map; // short ids are shown instead
    for (const p of data as { id: string; full_name: string | null; email: string | null }[])
      map.set(p.id, { name: p.full_name ?? null, email: p.email ?? null });
    return map;
  },

  // -------------------------------------------------------------------------
  // Realtime
  // -------------------------------------------------------------------------
  /**
   * New messages of one thread. `onSync` runs on every (re)subscription:
   * fetch then, so a message sent while disconnected is never missed.
   */
  subscribeMessages: (
    threadId: string,
    handlers: { onMessage: (m: SupportMessage) => void; onSync: () => void },
  ): (() => void) => {
    const channel = supabase
      .channel(`support-messages-${threadId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: MESSAGES, filter: `thread_id=eq.${threadId}` },
        (payload: { new: unknown }) => {
          const r = messageSchema.safeParse(payload.new);
          if (r.success) handlers.onMessage(r.data);
          else handlers.onSync(); // unexpected row: fetch instead
        },
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") handlers.onSync();
      });
    return () => void supabase.removeChannel(channel);
  },

  /** Thread inserts/updates the user may see (own threads, or all for staff). */
  subscribeThreads: (
    key: string,
    handlers: {
      onThread: (t: SupportThread, event: "INSERT" | "UPDATE") => void;
      onSync: () => void;
    },
  ): (() => void) => {
    const channel = supabase
      .channel(`support-threads-${key}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: THREADS },
        (payload: { eventType?: string; new: unknown }) => {
          const r = threadSchema.safeParse(payload.new);
          if (!r.success) return handlers.onSync();
          handlers.onThread(r.data, payload.eventType === "INSERT" ? "INSERT" : "UPDATE");
        },
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") handlers.onSync();
      });
    return () => void supabase.removeChannel(channel);
  },
};

export const supportKeys = {
  all: ["support"] as const,
  mine: (userId: string) => ["support", "threads", "mine", userId] as const,
  staff: (status: ThreadStatus | "all") => ["support", "threads", "staff", status] as const,
  thread: (id: string) => ["support", "thread", id] as const,
  messages: (id: string) => ["support", "messages", id] as const,
  last: (ids: string[]) => ["support", "last", ...ids] as const,
  unread: (userId: string) => ["support", "unread", userId] as const,
  people: (ids: string[]) => ["support", "people", ...ids] as const,
  attachment: (path: string) => ["support", "attachment", path] as const,
};
