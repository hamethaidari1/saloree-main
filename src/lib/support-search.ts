/** The messages pages' address: ids only, never message text. */

export type InboxView =
  { kind: "empty" } | { kind: "thread"; id: string } | { kind: "new"; orderId: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrUndefined = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : undefined);

/** ?thread=<id> opens a conversation; ?new=1&order=<id> starts one about an order. Ids only. */
export interface MessagesSearch {
  thread?: string;
  /** A number, so the address reads ?new=1 (strings are JSON-quoted). */
  new?: 1;
  order?: string;
}
export function parseMessagesSearch(s: Record<string, unknown>): MessagesSearch {
  const out: MessagesSearch = {};
  const thread = uuidOrUndefined(s["thread"]);
  const order = uuidOrUndefined(s["order"]);
  if (thread) out.thread = thread;
  if (s["new"] === "1" || s["new"] === 1) out.new = 1;
  if (order) out.order = order;
  return out;
}
export function initialView(s: MessagesSearch): InboxView {
  if (s.new) return { kind: "new", orderId: s.order ?? null };
  if (s.thread) return { kind: "thread", id: s.thread };
  return { kind: "empty" };
}
export function searchFor(view: InboxView): MessagesSearch {
  if (view.kind === "thread") return { thread: view.id };
  if (view.kind === "new") return view.orderId ? { new: 1, order: view.orderId } : { new: 1 };
  return {};
}
