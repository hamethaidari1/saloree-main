/**
 * Support chat: the pure rules (no network, no React). Message bodies never
 * appear in a thrown message, a log or a title.
 */
import { safeFileName } from "./seller-verification";

export const SUPPORT_TOPICS = ["order", "payment", "refund", "account", "seller", "other"] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];
export const THREAD_STATUSES = ["open", "closed"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];
export const SENDER_ROLES = ["user", "staff"] as const;
export type SenderRole = (typeof SENDER_ROLES)[number];

export const MESSAGE_MAX = 4000;
export const SUBJECT_MIN = 3;
export const SUBJECT_MAX = 120;
export const MAX_OPEN_THREADS = 5;

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------
export const ATTACHMENTS_BUCKET = "support-attachments";
export const ATTACHMENT_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AttachmentMime = (typeof ATTACHMENT_MIME_TYPES)[number];
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const ATTACHMENT_ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
const EXTENSIONS: Record<AttachmentMime, readonly string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
};

export type AttachmentProblem = "fileType" | "fileSize";
/** Why an image can't be sent, or null. */
export function attachmentProblem(file: {
  name: string;
  type: string;
  size: number;
}): AttachmentProblem | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = ATTACHMENT_MIME_TYPES.find((m) => m === file.type);
  if (!mime || !EXTENSIONS[mime].includes(ext)) return "fileType";
  if (file.size <= 0 || file.size > MAX_ATTACHMENT_BYTES) return "fileSize";
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `<thread_id>/<uuid>-<safe-name>`: the only path the storage rules accept. */
export function attachmentPath(threadId: string, fileName: string, uuid: string): string {
  if (!UUID.test(threadId)) throw new Error("Unknown conversation.");
  return `${threadId}/${uuid}-${safeFileName(fileName)}`;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------
export interface MessageLike {
  id: string;
  created_at: string;
}

/** Oldest first; same instant → by id, so the order never flickers. */
export const compareMessages = (a: MessageLike, b: MessageLike) =>
  a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at < b.created_at ? -1 : 1;

/**
 * Everything we know, once: the list after a (re)fetch plus anything that
 * arrived live. The same id twice keeps the later copy; order by time.
 */
export function mergeMessages<T extends MessageLike>(...lists: (readonly T[] | undefined)[]): T[] {
  const byId = new Map<string, T>();
  for (const list of lists) for (const m of list ?? []) byId.set(m.id, m);
  return [...byId.values()].sort(compareMessages);
}

/** Local calendar day "YYYY-MM-DD" of an ISO time. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Messages grouped by local day, in order (for the day separators). */
export function groupByDay<T extends MessageLike>(messages: readonly T[]) {
  const groups: { day: string; messages: T[] }[] = [];
  for (const m of [...messages].sort(compareMessages)) {
    const day = localDay(m.created_at);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.messages.push(m);
    else groups.push({ day, messages: [m] });
  }
  return groups;
}

/** "today" / "yesterday" / null (then the date is shown). */
export function relativeDay(day: string, now: Date = new Date()): "today" | "yesterday" | null {
  if (day === localDay(now.toISOString())) return "today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  return day === localDay(y.toISOString()) ? "yesterday" : null;
}

/** Text → text and http(s) links (shown as links, never interpreted as HTML). */
export function linkify(
  text: string,
): ({ type: "text"; value: string } | { type: "link"; href: string; value: string })[] {
  const out: ({ type: "text"; value: string } | { type: "link"; href: string; value: string })[] =
    [];
  const re = /https?:\/\/[^\s<>"']+/gi;
  let last = 0;
  for (const m of text.matchAll(re)) {
    let url = m[0];
    // "…see https://x.com/a." — the final punctuation isn't part of the link.
    const trail = /[.,;:!?)\]}'"]+$/.exec(url)?.[0] ?? "";
    if (trail) url = url.slice(0, -trail.length);
    const start = m.index ?? 0;
    if (start > last) out.push({ type: "text", value: text.slice(last, start) });
    try {
      const u = new URL(url);
      if (u.protocol === "http:" || u.protocol === "https:")
        out.push({ type: "link", href: u.href, value: url });
      else out.push({ type: "text", value: url });
    } catch {
      out.push({ type: "text", value: url });
    }
    last = start + url.length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------
export interface ThreadLike {
  id: string;
  status: ThreadStatus;
  last_message_at: string | null;
  last_sender_role: SenderRole | null;
  user_last_read_at: string | null;
  staff_last_read_at: string | null;
  created_at: string;
}

/** Unread for this side: the other side wrote last, after we last read. */
export function isUnread(t: ThreadLike, viewer: SenderRole): boolean {
  if (!t.last_message_at || !t.last_sender_role || t.last_sender_role === viewer) return false;
  const read = viewer === "user" ? t.user_last_read_at : t.staff_last_read_at;
  return !read || read < t.last_message_at;
}

export const unreadCount = (threads: readonly ThreadLike[], viewer: SenderRole) =>
  threads.filter((t) => isUnread(t, viewer)).length;

/** Customer list: newest activity first. */
export function sortThreads<T extends ThreadLike>(threads: readonly T[]): T[] {
  const at = (t: T) => t.last_message_at ?? t.created_at;
  return [...threads].sort((a, b) =>
    at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : a.id.localeCompare(b.id),
  );
}

/**
 * Staff inbox: open threads waiting for us (the user wrote last) first, the
 * longest wait first; then other open threads, then closed ones, newest first.
 */
export function sortInbox<T extends ThreadLike>(threads: readonly T[]): T[] {
  const rank = (t: T) =>
    t.status === "open" && t.last_sender_role === "user" ? 0 : t.status === "open" ? 1 : 2;
  const at = (t: T) => t.last_message_at ?? t.created_at;
  return [...threads].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (rank(a) === 0) return at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0;
    return at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0;
  });
}

export const isWaitingForTeam = (t: ThreadLike) =>
  t.status === "open" && t.last_sender_role === "user";

/** "(3) Saloree": the unread count in front of the page title; never message text. */
export function titleWithCount(title: string, count: number): string {
  const base = title.replace(/^\(\d+\)\s+/, "");
  return count > 0 ? `(${count}) ${base}` : base;
}

/**
 * Whether a live thread change is a new team reply worth a toast: the user's
 * own thread, the team wrote last, still unread, not the conversation on
 * screen, and not already announced (one toast per reply, not per update).
 */
export function shouldNotify(
  thread: ThreadLike & { user_id: string },
  userId: string,
  activeThreadId: string | null,
  announced: Map<string, string>,
): boolean {
  if (thread.user_id !== userId || thread.last_sender_role !== "staff") return false;
  if (!isUnread(thread, "user") || !thread.last_message_at) return false;
  if (activeThreadId === thread.id) return false;
  if (announced.get(thread.id) === thread.last_message_at) return false;
  announced.set(thread.id, thread.last_message_at);
  return true;
}
