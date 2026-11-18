import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Photos are shrunk before upload; jsdom has no canvas encoder (see ./fake-image).
vi.mock("@/lib/image-optimize", async (orig) =>
  (await import("./fake-image")).withFakeCodec(await orig<typeof import("@/lib/image-optimize")>()),
);
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createSupabaseMock } from "./supabase-mock";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

import {
  attachmentPath,
  attachmentProblem,
  groupByDay,
  isUnread,
  linkify,
  MAX_ATTACHMENT_BYTES,
  mergeMessages,
  shouldNotify,
  sortInbox,
  titleWithCount,
  unreadCount,
} from "@/lib/support";
import { initialView, parseMessagesSearch, searchFor } from "@/lib/support-search";
import {
  sendMessageArgsSchema,
  startThreadArgsSchema,
  startThreadIssues,
  SupportDbError,
  supportErrorText,
  supportService,
  unreadCountsSchema,
  type SupportMessage,
  type SupportThread,
} from "@/services/support";
import { ConversationView } from "@/components/support/conversation";
import { stillPending, type PendingMessage } from "@/components/support/sender";
import { applyFetch, applyLiveMessage } from "@/components/support/use-support";
import { UnreadBadge } from "@/components/support/notifier";
import { SupportInbox } from "@/components/support/inbox";

const m = () => mock.current!;
const T1 = "11111111-1111-4111-8111-111111111111";
const USER = "6f1c2b0a-4d3e-4f5a-9b8c-7d6e5f4a3b2c";
const ORDER = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  m().reset();
  m().state.session = { user: { id: USER } };
});
afterEach(() => vi.restoreAllMocks());

const thread = (patch: Partial<SupportThread> = {}): SupportThread => ({
  id: T1,
  user_id: USER,
  topic: "order",
  subject: "Where is my parcel?",
  order_id: null,
  status: "open",
  last_message_at: "2026-11-15T10:00:00Z",
  last_sender_role: "user",
  user_last_read_at: "2026-11-15T10:00:00Z",
  staff_last_read_at: null,
  closed_by: null,
  closed_at: null,
  created_at: "2026-11-14T09:00:00Z",
  ...patch,
});
let seq = 0;
const msg = (patch: Partial<SupportMessage> = {}): SupportMessage => ({
  id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
  thread_id: T1,
  sender_id: USER,
  sender_role: "user",
  body: "Hello",
  attachment_path: null,
  attachment_mime: null,
  created_at: "2026-11-15T10:00:00Z",
  ...patch,
});

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);

// ---------------------------------------------------------------------------
// Schemas and the RPCs
// ---------------------------------------------------------------------------
describe("payloads (zod)", () => {
  it("new conversation: subject 3-120, a message, an optional order id", () => {
    expect(startThreadIssues({ topic: "order", subject: "Hi", body: "x", orderId: null })).toEqual({
      subject: "subjectShort",
    });
    expect(
      startThreadIssues({ topic: "order", subject: "Parcel", body: "  ", orderId: null }),
    ).toEqual({
      body: "messageEmpty",
    });
    expect(
      startThreadIssues({
        topic: "order",
        subject: "Parcel",
        body: "x".repeat(4001),
        orderId: null,
      }),
    ).toEqual({
      body: "messageLong",
    });
    expect(
      startThreadIssues({ topic: "refund", subject: "Parcel", body: "Hi", orderId: ORDER }),
    ).toEqual({});
    expect(
      startThreadArgsSchema.safeParse({
        p_topic: "spam",
        p_subject: "abc",
        p_body: "x",
        p_order_id: null,
      }).success,
    ).toBe(false);
    expect(
      startThreadArgsSchema.safeParse({
        p_topic: "order",
        p_subject: "abc",
        p_body: "x",
        p_order_id: null,
        p_user: USER,
      }).success,
    ).toBe(false);
  });

  it("message: text or an image (inside this thread's folder), nothing else", () => {
    const base = {
      p_thread_id: T1,
      p_body: "Hi",
      p_attachment_path: null,
      p_attachment_mime: null,
    };
    expect(sendMessageArgsSchema.safeParse(base).success).toBe(true);
    expect(sendMessageArgsSchema.safeParse({ ...base, p_body: " " }).success).toBe(false);
    expect(
      sendMessageArgsSchema.safeParse({
        ...base,
        p_body: "",
        p_attachment_path: `${T1}/a-x.png`,
        p_attachment_mime: "image/png",
      }).success,
    ).toBe(true);
    expect(
      sendMessageArgsSchema.safeParse({
        ...base,
        p_attachment_path: `${USER}/a-x.png`,
        p_attachment_mime: "image/png",
      }).success,
    ).toBe(false);
    expect(
      sendMessageArgsSchema.safeParse({ ...base, p_attachment_path: `${T1}/a.png` }).success,
    ).toBe(false);
    expect(sendMessageArgsSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });

  it("support_unread_counts: object or a single row", () => {
    expect(unreadCountsSchema.parse({ mine: 2, staff: "5" })).toEqual({ mine: 2, staff: 5 });
    expect(unreadCountsSchema.parse([{ mine: 0, staff: 1 }])).toEqual({ mine: 0, staff: 1 });
    expect(unreadCountsSchema.safeParse({ mine: -1, staff: 0 }).success).toBe(false);
  });
});

describe("service: the real RPC names and arguments", () => {
  it("start_support_thread / send_support_message / mark read / status / counts", async () => {
    m().state.queue.push({ data: T1 });
    expect(
      await supportService.startThread({
        topic: "order",
        subject: " Parcel ",
        body: " Late ",
        orderId: ORDER,
      }),
    ).toBe(T1);
    const id = "33333333-3333-4333-8333-333333333333";
    m().state.queue.push({ data: id });
    expect(
      await supportService.sendMessage({ threadId: T1, body: " Thanks ", attachment: null }),
    ).toBe(id);
    await supportService.markRead(T1);
    await supportService.setStatus(T1, "closed");
    m().state.queue.push({ data: { mine: 1, staff: 0 } });
    expect(await supportService.unreadCounts()).toEqual({ mine: 1, staff: 0 });
    expect(m().state.rpcs).toEqual([
      {
        fn: "start_support_thread",
        args: { p_topic: "order", p_subject: "Parcel", p_body: "Late", p_order_id: ORDER },
      },
      {
        fn: "send_support_message",
        args: {
          p_thread_id: T1,
          p_body: "Thanks",
          p_attachment_path: null,
          p_attachment_mime: null,
        },
      },
      { fn: "mark_support_thread_read", args: { p_thread_id: T1 } },
      { fn: "set_support_thread_status", args: { p_thread_id: T1, p_status: "closed" } },
      { fn: "support_unread_counts", args: undefined },
    ]);
    // No table is written directly.
    for (const q of m().state.queries)
      expect(q.calls.map((c) => c[0])).not.toEqual(
        expect.arrayContaining(["insert", "update", "upsert", "delete"]),
      );
  });

  it("readable database errors are kept as they are; details/hint never", async () => {
    m().state.queue.push({
      error: {
        code: "P0001",
        message: "You already have 5 open conversations.",
        details: "Hello secret",
        hint: "x",
      },
    });
    const e = await supportService
      .startThread({ topic: "other", subject: "Hello", body: "Hello secret", orderId: null })
      .catch((x: unknown) => x);
    expect(supportErrorText(e)).toBe("You already have 5 open conversations. (P0001)");
    expect(JSON.stringify(e)).not.toContain("secret");
  });

  it("images: <thread_id>/<uuid>-<safe-name> in the private bucket, shown by 60-second links", async () => {
    const file = new File(["x"], "My Photo (1).PNG", { type: "image/png" });
    const up = await supportService.uploadAttachment(T1, file);
    // Shrunk and saved as WebP (metadata removed) before upload.
    expect(up.mime).toBe("image/webp");
    expect(m().state.uploads).toHaveLength(1);
    expect(m().state.uploads[0]!.bucket).toBe("support-attachments");
    expect(up.path).toMatch(new RegExp(`^${T1}/[0-9a-f-]{36}-my-photo-1\\.webp$`));
    await supportService.attachmentUrl(up.path);
    expect(m().state.signed).toEqual([
      { bucket: "support-attachments", path: up.path, expiresIn: 60 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------
describe("files and paths", () => {
  it("JPG, PNG and WebP up to 5 MB", () => {
    const f = (name: string, type: string, size = 100) => ({ name, type, size });
    expect(attachmentProblem(f("a.jpg", "image/jpeg"))).toBeNull();
    expect(attachmentProblem(f("a.webp", "image/webp", MAX_ATTACHMENT_BYTES))).toBeNull();
    expect(attachmentProblem(f("a.gif", "image/gif"))).toBe("fileType");
    expect(attachmentProblem(f("a.pdf", "application/pdf"))).toBe("fileType");
    expect(attachmentProblem(f("a.png.exe", "image/png"))).toBe("fileType");
    expect(attachmentProblem(f("a.png", "image/png", MAX_ATTACHMENT_BYTES + 1))).toBe("fileSize");
  });
  it("the path always starts with the thread id", () => {
    const uuid = "44444444-4444-4444-8444-444444444444";
    for (const name of ["../../x.png", "a/b.png", "<script>.jpg", ""]) {
      const p = attachmentPath(T1, name, uuid);
      expect(p.startsWith(`${T1}/${uuid}-`), name).toBe(true);
      expect(p.slice(T1.length + 1), name).toMatch(/^[a-z0-9-]+(\.[a-z0-9]+)?$/);
    }
    expect(() => attachmentPath("../other", "a.png", uuid)).toThrow();
  });
});

describe("messages: order, days, links", () => {
  it("oldest first; same id once", () => {
    const a = msg({ created_at: "2026-11-15T09:00:00Z" });
    const b = msg({ created_at: "2026-11-15T10:00:00Z" });
    const c = msg({ created_at: "2026-11-15T08:00:00Z" });
    expect(mergeMessages([b, a], [a, c]).map((x) => x.id)).toEqual([c.id, a.id, b.id]);
  });
  it("groups by local day", () => {
    const days = groupByDay([
      msg({ created_at: new Date(2026, 10, 14, 12).toISOString() }),
      msg({ created_at: new Date(2026, 10, 15, 9).toISOString() }),
      msg({ created_at: new Date(2026, 10, 15, 18).toISOString() }),
    ]);
    expect(days.map((d) => [d.day, d.messages.length])).toEqual([
      ["2026-11-14", 1],
      ["2026-11-15", 2],
    ]);
  });
  it("links: http(s) only, without the final punctuation", () => {
    expect(linkify("See https://saloree.com/help. Or javascript:alert(1)")).toEqual([
      { type: "text", value: "See " },
      { type: "link", href: "https://saloree.com/help", value: "https://saloree.com/help" },
      { type: "text", value: ". Or javascript:alert(1)" },
    ]);
  });
});

describe("realtime merge", () => {
  it("a live message then the refetch that contains it: once", () => {
    const a = msg();
    const live = msg({ created_at: "2026-11-15T11:00:00Z" });
    let cache = applyFetch(undefined, [a]);
    cache = applyLiveMessage(cache, live);
    cache = applyLiveMessage(cache, live); // delivered twice
    cache = applyFetch(cache, [a, live]);
    expect(cache.map((x) => x.id)).toEqual([a.id, live.id]);
  });
  it("after a reconnect, a message sent during the gap is added", () => {
    const a = msg();
    const missed = msg({ created_at: "2026-11-15T12:00:00Z" });
    expect(applyFetch([a], [a, missed]).map((x) => x.id)).toEqual([a.id, missed.id]);
  });
  it("a live message that arrives while a fetch is in flight is not dropped", () => {
    const a = msg();
    const live = msg({ created_at: "2026-11-15T13:00:00Z" });
    // The fetch started before `live` existed; the cache already has it.
    expect(applyFetch([a, live], [a]).map((x) => x.id)).toEqual([a.id, live.id]);
  });
});

describe("unread and notifications", () => {
  it("unread for one side when the other wrote after they read", () => {
    const t = thread({
      last_sender_role: "staff",
      last_message_at: "2026-11-15T11:00:00Z",
      user_last_read_at: "2026-11-15T10:00:00Z",
    });
    expect(isUnread(t, "user")).toBe(true);
    expect(isUnread(t, "staff")).toBe(false);
    expect(isUnread({ ...t, user_last_read_at: "2026-11-15T11:00:00Z" }, "user")).toBe(false);
    expect(isUnread(thread({ last_sender_role: "user", staff_last_read_at: null }), "staff")).toBe(
      true,
    );
    expect(unreadCount([t, thread()], "user")).toBe(1);
  });
  it("staff inbox: waiting for us first (longest wait first), then the rest", () => {
    const waitingOld = thread({
      id: "a",
      last_sender_role: "user",
      last_message_at: "2026-11-10T00:00:00Z",
    });
    const waitingNew = thread({
      id: "b",
      last_sender_role: "user",
      last_message_at: "2026-11-14T00:00:00Z",
    });
    const answered = thread({
      id: "c",
      last_sender_role: "staff",
      last_message_at: "2026-11-15T00:00:00Z",
    });
    const closed = thread({ id: "d", status: "closed", last_sender_role: "user" });
    expect(sortInbox([answered, closed, waitingNew, waitingOld]).map((x) => x.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });
  it("one toast per team reply, never for the open conversation", () => {
    const announced = new Map<string, string>();
    const reply = thread({ last_sender_role: "staff", last_message_at: "2026-11-15T11:00:00Z" });
    expect(shouldNotify(reply, USER, T1, announced)).toBe(false); // on screen
    expect(shouldNotify(reply, USER, null, announced)).toBe(true);
    expect(
      shouldNotify({ ...reply, staff_last_read_at: "2026-11-15T11:01:00Z" }, USER, null, announced),
    ).toBe(false);
    expect(shouldNotify({ ...reply, user_id: "someone-else" }, USER, null, new Map())).toBe(false);
    expect(shouldNotify(thread(), USER, null, new Map())).toBe(false); // the user wrote last
  });
  it("the title shows a count, never text; the badge hides at 0", () => {
    expect(titleWithCount("Messages — Saloree", 2)).toBe("(2) Messages — Saloree");
    expect(titleWithCount("(2) Messages — Saloree", 0)).toBe("Messages — Saloree");
    const { container, rerender } = render(<UnreadBadge count={0} />);
    expect(container.textContent).toBe("");
    rerender(<UnreadBadge count={120} />);
    expect(screen.getByTestId("unread-badge").textContent).toBe("99+");
  });
  it("addresses carry ids only", () => {
    expect(parseMessagesSearch({ thread: T1, text: "hello" })).toEqual({ thread: T1 });
    expect(parseMessagesSearch({ thread: "not-an-id", new: "1", order: ORDER })).toEqual({
      new: 1,
      order: ORDER,
    });
    expect(parseMessagesSearch({ new: 1 })).toEqual({ new: 1 });
    expect(initialView({ new: 1, order: ORDER })).toEqual({ kind: "new", orderId: ORDER });
    expect(searchFor({ kind: "thread", id: T1 })).toEqual({ thread: T1 });
    // A number, so the address reads ?new=1 (not ?new=%221%22).
    expect(searchFor({ kind: "new", orderId: null })).toEqual({ new: 1 });
  });
});

// ---------------------------------------------------------------------------
// The conversation
// ---------------------------------------------------------------------------
describe("conversation", () => {
  function setup(t: SupportThread, server: SupportMessage[], viewer: "user" | "staff" = "user") {
    const list = { current: server };
    vi.spyOn(supportService, "messages").mockImplementation(async () => list.current);
    vi.spyOn(supportService, "markRead").mockResolvedValue();
    render(
      wrap(
        <ConversationView
          thread={t}
          viewer={viewer}
          audience={viewer === "user" ? "customer" : "staff"}
          customerName="Sara"
          onStartNew={() => {}}
        />,
      ),
    );
    return list;
  }

  it("labels: You / Saloree team for the customer; the customer's name for staff", async () => {
    setup(thread(), [
      msg({ body: "My parcel?" }),
      msg({
        sender_role: "staff",
        sender_id: "staff-1",
        body: "On its way.",
        created_at: "2026-11-15T10:05:00Z",
      }),
    ]);
    const items = await screen.findAllByTestId("support-message");
    expect(items.map((i) => i.querySelector("strong")?.textContent)).toEqual([
      "You",
      "Saloree team",
    ]);
    expect(items[0]!.getAttribute("data-side")).toBe("mine");
    expect(
      screen.getByText("The Saloree team usually replies within 1 business day."),
    ).toBeTruthy();
  });

  it("staff see the customer's name, and replies stay 'Saloree team'", async () => {
    setup(
      thread(),
      [
        msg({ body: "My parcel?" }),
        msg({ sender_role: "staff", body: "Sent.", created_at: "2026-11-15T10:05:00Z" }),
      ],
      "staff",
    );
    const items = await screen.findAllByTestId("support-message");
    expect(items.map((i) => i.querySelector("strong")?.textContent)).toEqual([
      "Sara",
      "Saloree team",
    ]);
  });

  it("day separators and plain-text bodies with safe links", async () => {
    setup(thread(), [
      msg({
        body: "<b>bold?</b> see https://saloree.com",
        created_at: new Date(2026, 10, 10, 9).toISOString(),
      }),
      msg({ created_at: new Date(2026, 10, 11, 9).toISOString() }),
    ]);
    await screen.findAllByTestId("support-message");
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
    const log = screen.getByTestId("support-log");
    expect(log.querySelector("b")).toBeNull();
    expect(log.textContent).toContain("<b>bold?</b>");
    const link = within(log).getByRole("link", { name: "https://saloree.com" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });

  it("live messages appear once; a reconnect refetch adds what was missed", async () => {
    const first = msg({ body: "Hi" });
    const list = setup(thread(), [first]);
    await screen.findAllByTestId("support-message");
    const live = msg({
      sender_role: "staff",
      body: "Hello from the team",
      created_at: "2026-11-15T10:10:00Z",
    });
    act(() => {
      m().realtime.emit("support_messages", { new: live });
      m().realtime.emit("support_messages", { new: live });
    });
    await waitFor(() => expect(screen.getAllByTestId("support-message")).toHaveLength(2));
    // Polite announcement: who wrote, not what.
    expect(screen.getByTestId("support-announce").getAttribute("aria-live")).toBe("polite");
    expect(screen.getByTestId("support-announce").textContent).toBe(
      "New message from Saloree team",
    );
    // Another thread's message is ignored.
    act(() => m().realtime.emit("support_messages", { new: { ...msg(), thread_id: "x" } }));
    const missed = msg({
      sender_role: "staff",
      body: "While you were offline",
      created_at: "2026-11-15T10:20:00Z",
    });
    list.current = [first, live, missed];
    act(() => m().realtime.connect("SUBSCRIBED"));
    await waitFor(() => expect(screen.getAllByTestId("support-message")).toHaveLength(3));
    expect(screen.getByText("While you were offline")).toBeTruthy();
  });

  it("send at once, show a failure with the database's text, retry", async () => {
    setup(thread(), []);
    await screen.findByText("No messages yet.");
    const send = vi
      .spyOn(supportService, "sendMessage")
      .mockRejectedValueOnce(new SupportDbError("You are sending messages too fast.", "P0001"))
      .mockResolvedValueOnce("55555555-5555-4555-8555-555555555555");
    const box = screen.getByLabelText("Your message");
    fireEvent.change(box, { target: { value: "Line one" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true }); // a new line, not sent
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByTestId("support-pending")).toBeTruthy();
    const failed = await screen.findByRole("alert");
    expect(failed.textContent).toContain("You are sending messages too fast. (P0001)");
    expect(send).toHaveBeenCalledWith({ threadId: T1, body: "Line one", attachment: null });
    fireEvent.click(within(failed).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("pending messages disappear once the real one is listed", () => {
    const p: PendingMessage = {
      clientId: "c1",
      body: "x",
      file: null,
      uploaded: null,
      status: "sending",
      error: null,
      serverId: "id-1",
      createdAt: "",
    };
    expect(stillPending([p], [])).toHaveLength(1);
    expect(stillPending([p], [{ ...msg(), id: "id-1" }])).toHaveLength(0);
  });

  it("rejects a wrong image type before sending", async () => {
    setup(thread(), []);
    await screen.findByText("No messages yet.");
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, {
      target: { files: [new File(["x"], "a.gif", { type: "image/gif" })] },
    });
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Only JPG, PNG and WebP images can be sent.",
    );
  });

  it("closed: read-only, with a way to start a new conversation", async () => {
    setup(thread({ status: "closed" }), [msg()]);
    await screen.findAllByTestId("support-message");
    expect(screen.queryByLabelText("Your message")).toBeNull();
    expect(screen.getByText("This conversation is closed.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start a new conversation" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close conversation" })).toBeNull();
  });

  it("marks the conversation read when it is open", async () => {
    setup(thread({ last_sender_role: "staff" }), [msg()]);
    await screen.findAllByTestId("support-message");
    expect(supportService.markRead).toHaveBeenCalledWith(T1);
  });
});

describe("inbox: list, new conversation, focus", () => {
  it("opens a conversation and moves focus to its subject; the form warns about card numbers", async () => {
    vi.spyOn(supportService, "myThreads").mockResolvedValue([
      thread({ last_sender_role: "staff", last_message_at: "2026-11-15T11:00:00Z" }),
    ]);
    vi.spyOn(supportService, "lastMessages").mockResolvedValue(
      new Map([
        [T1, { body: "Your parcel left today.", hasImage: false, sender_role: "staff" as const }],
      ]),
    );
    vi.spyOn(supportService, "messages").mockResolvedValue([]);
    vi.spyOn(supportService, "markRead").mockResolvedValue();
    render(
      wrap(
        <SupportInbox
          audience="customer"
          userId={USER}
          orders={[{ id: ORDER, created_at: "2026-11-01T00:00:00Z" }]}
          initial={{ kind: "empty" }}
        />,
      ),
    );
    const item = await screen.findByTestId("support-thread");
    expect(item.getAttribute("data-unread")).toBe("true");
    expect(item.textContent).toContain("Your parcel left today.");
    fireEvent.click(item);
    const heading = await screen.findByRole("heading", { level: 2, name: "Where is my parcel?" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(await screen.findByText("Please do not send card numbers or passwords.")).toBeTruthy();
    expect(screen.getByLabelText("Order (optional)")).toBeTruthy();
  });

  it("a prefilled order must be one of the user's own", async () => {
    vi.spyOn(supportService, "myThreads").mockResolvedValue([]);
    render(
      wrap(
        <SupportInbox
          audience="customer"
          userId={USER}
          orders={[{ id: ORDER, created_at: "2026-11-01T00:00:00Z" }]}
          initial={{ kind: "new", orderId: "99999999-9999-4999-8999-999999999999" }}
        />,
      ),
    );
    expect(((await screen.findByLabelText("Order (optional)")) as HTMLSelectElement).value).toBe(
      "",
    );
  });

  it("starting a conversation: the database's limit message is shown as it is", async () => {
    vi.spyOn(supportService, "myThreads").mockResolvedValue([]);
    vi.spyOn(supportService, "startThread").mockRejectedValue(
      new SupportDbError("You already have 5 open conversations.", "P0001"),
    );
    render(
      wrap(
        <SupportInbox
          audience="customer"
          userId={USER}
          orders={[{ id: ORDER, created_at: "2026-11-01T00:00:00Z" }]}
          initial={{ kind: "new", orderId: ORDER }}
        />,
      ),
    );
    expect(((await screen.findByLabelText("Order (optional)")) as HTMLSelectElement).value).toBe(
      ORDER,
    );
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Late parcel" } });
    fireEvent.change(screen.getByLabelText("Your message"), { target: { value: "It is late." } });
    fireEvent.click(screen.getByRole("button", { name: "Start conversation" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "You already have 5 open conversations. (P0001)",
    );
    expect(supportService.startThread).toHaveBeenCalledWith({
      topic: "order",
      subject: "Late parcel",
      body: "It is late.",
      orderId: ORDER,
    });
  });
});

// ---------------------------------------------------------------------------
// Entry points and privacy (source checks)
// ---------------------------------------------------------------------------
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
describe("entry points by role", () => {
  it("customers: account menu, Customer Service, each own order", () => {
    expect(read("src/components/marketplace/header/account-menu.tsx")).toContain(
      'to="/account/messages"',
    );
    expect(read("src/routes/help.tsx")).toContain(
      '<Link to="/account/messages" search={{ new: 1 }}>',
    );
    expect(read("src/routes/account.tsx")).toContain("search={{ new: 1, order: o.id }}");
  });
  it("sellers: a Support item with a badge; staff: Messages in all three panels", async () => {
    const { SELLER_NAV } = await import("@/components/seller/seller-shell");
    expect(SELLER_NAV.map((i) => i.to)).toContain("/seller/support");
    for (const [file, panel] of [
      ["src/routes/admin.tsx", "admin"],
      ["src/routes/admin_.marketplace.tsx", "marketplace"],
      ["src/routes/admin_.finance.tsx", "finance"],
    ] as const)
      expect(read(file), file).toContain(`<StaffSupportPanel panel="${panel}" />`);
  });
});

describe("privacy", () => {
  const files = [
    "src/lib/support.ts",
    "src/services/support.ts",
    "src/components/staff/staff-support.tsx",
    ...readdirSync(join(process.cwd(), "src/components/support")).map(
      (f) => `src/components/support/${f}`,
    ),
  ];
  it("no logging, no analytics, no Web Push or notification permission", () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/console\.(log|info|warn|error|debug)|gtag|dataLayer|sendBeacon/);
      expect(src, f).not.toMatch(/Notification\.requestPermission|PushManager|serviceWorker/);
      expect(src, f).not.toMatch(/getPublicUrl/);
    }
  });
  it("toasts only say 'New message from Saloree team'; titles carry a count only", () => {
    for (const f of files) {
      const src = read(f);
      for (const call of src.matchAll(/toast(?:\.\w+)?\(([^)]*)\)/g))
        expect(call[1], `${f}: ${call[0]}`).toBe("text.current");
      expect(src, f).not.toMatch(/document\.title\s*=\s*[^;]*(body|subject)/);
    }
  });
  it("localStorage only for the sound preference", () => {
    for (const f of files) {
      const src = read(f);
      const uses = src.match(/localStorage\.\w+\([^)]*\)/g) ?? [];
      for (const u of uses) expect(u, f).toMatch(/SOUND_KEY/);
      expect(src, f).not.toMatch(/sessionStorage|indexedDB|document\.cookie/);
    }
  });
});
