import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  type AnyRouter,
} from "@tanstack/react-router";
import { createSupabaseMock } from "./supabase-mock";
import { WithLocale } from "./i18n";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

const auth = vi.hoisted(() => ({
  value: {
    user: null as { id: string } | null,
    isSeller: false,
    roles: [] as string[],
    ready: true,
  },
}));
vi.mock("@/lib/auth", () => ({ useAuth: () => auth.value }));

import { SideWidget } from "@/components/marketplace/side-widget";
import { FeedbackPanel } from "@/components/staff/feedback-panel";
import { pathOnly, showsSideWidget } from "@/lib/side-widget";
import {
  feedbackIssues,
  feedbackService,
  submitFeedbackArgsSchema,
  toSubmitArgs,
  type FeedbackRow,
} from "@/services/feedback";

const m = () => mock.current!;
beforeEach(() => {
  m().reset();
  auth.value = { user: null, isSeller: false, roles: [], ready: true };
});
afterEach(() => {
  vi.restoreAllMocks();
  setScroll(0);
});

function setScroll(y: number) {
  Object.defineProperty(window, "scrollY", { value: y, configurable: true, writable: true });
}

const PAGES = [
  "/",
  "/help",
  "/products",
  "/checkout",
  "/seller",
  "/seller/orders",
  "/admin",
  "/login",
  "/register",
  "/order-confirmation/$groupId",
];

function renderAt(path: string, locale: "en" | "ar" = "en", queryClient = new QueryClient()) {
  const root = createRootRoute({
    component: () => (
      <WithLocale locale={locale}>
        <header>
          <a href="/">Home</a>
        </header>
        <Outlet />
        <SideWidget />
      </WithLocale>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren(
      PAGES.map((p) =>
        createRoute({ getParentRoute: () => root, path: p, component: () => <p>{p}</p> }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as AnyRouter} />
    </QueryClientProvider>,
  );
  return router;
}

// ---------------------------------------------------------------------------
// Where and what
// ---------------------------------------------------------------------------
describe("side widget: where it shows", () => {
  it("marketplace and storefront pages yes; checkout, dashboards, sign-in and confirmation no", () => {
    for (const p of [
      "/",
      "/products",
      "/product/x",
      "/store/beta",
      "/category/lamps",
      "/help",
      "/cart",
    ])
      expect(showsSideWidget(p), p).toBe(true);
    for (const p of [
      "/checkout",
      "/checkout/",
      "/seller",
      "/seller/orders",
      "/admin",
      "/admin/marketplace",
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password",
      "/auth/callback",
      "/order-confirmation",
      "/order-confirmation/abc",
      "/preview/store",
    ])
      expect(showsSideWidget(p), p).toBe(false);
  });

  it("renders nothing on excluded routes", async () => {
    for (const p of [
      "/checkout",
      "/seller/orders",
      "/admin",
      "/login",
      "/register",
      "/order-confirmation/g1",
    ]) {
      renderAt(p);
      await screen.findByText(
        p.startsWith("/order-confirmation") ? "/order-confirmation/$groupId" : p,
      );
      expect(screen.queryByTestId("side-widget"), p).toBeNull();
      cleanup();
    }
    renderAt("/help");
    expect(await screen.findByTestId("side-widget")).toBeTruthy();
  });

  it("Messages, Feedback, Top: in this order, with accessible names", async () => {
    setScroll(800);
    renderAt("/products");
    const widget = await screen.findByTestId("side-widget");
    expect(widget.tagName).toBe("ASIDE");
    expect(widget.getAttribute("aria-label")).toBe("Messages and feedback");
    const messages = within(widget).getByRole("link", { name: "Messages" });
    const feedback = within(widget).getByRole("button", { name: "Feedback" });
    const top = within(widget).getByRole("button", { name: "Back to top" });
    expect([...widget.querySelectorAll("a, button")]).toEqual([messages, feedback, top]);
    expect(within(widget).queryByRole("link", { name: "Help" })).toBeNull();
  });

  it("Messages: sign-in (then back to the messages), the customer inbox, or the seller inbox", async () => {
    renderAt("/");
    const signedOut = await screen.findByRole("link", { name: "Messages" });
    expect(signedOut.getAttribute("href")).toBe("/login?redirect=%2Faccount%2Fmessages");
    expect(screen.queryByTestId("unread-badge")).toBeNull();
    expect(m().state.rpcs).toHaveLength(0); // no count is asked for when signed out
    cleanup();

    auth.value = { user: { id: "u1" }, isSeller: false, roles: ["customer"], ready: true };
    m().state.fallback = { data: { mine: 0, staff: 0 } };
    renderAt("/");
    expect((await screen.findByRole("link", { name: "Messages" })).getAttribute("href")).toBe(
      "/account/messages",
    );
    cleanup();

    auth.value = { user: { id: "u2" }, isSeller: true, roles: ["seller"], ready: true };
    renderAt("/");
    expect((await screen.findByRole("link", { name: "Messages" })).getAttribute("href")).toBe(
      "/seller/support",
    );
  });

  it("the unread badge: shown with the count (99+ cap) and in the name; hidden at 0", async () => {
    auth.value = { user: { id: "u1" }, isSeller: false, roles: ["customer"], ready: true };
    m().state.fallback = { data: { mine: 2, staff: 7 } };
    renderAt("/");
    const link = await screen.findByRole("link", { name: "Messages, 2 unread" });
    const badge = within(link).getByTestId("unread-badge");
    expect(badge.textContent).toBe("2");
    expect(badge.getAttribute("aria-hidden")).toBe("true");
    expect(badge.closest(".side-widget-icon")).toBeTruthy(); // on the icon
    cleanup();

    m().state.fallback = { data: { mine: 150, staff: 0 } };
    renderAt("/");
    const many = await screen.findByRole("link", { name: "Messages, 150 unread" });
    expect(within(many).getByTestId("unread-badge").textContent).toBe("99+");
    cleanup();

    m().state.fallback = { data: { mine: 0, staff: 3 } };
    renderAt("/");
    await screen.findByRole("link", { name: "Messages" });
    await waitFor(() => expect(m().state.rpcs.length).toBeGreaterThan(0));
    expect(screen.queryByTestId("unread-badge")).toBeNull();
  });

  it("reuses the account menu cached count: one request, no subscription of its own", async () => {
    auth.value = { user: { id: "u1" }, isSeller: false, roles: ["customer"], ready: true };
    m().state.fallback = { data: { mine: 1, staff: 0 } };
    const { AccountMenuPanel } = await import("@/components/marketplace/header/account-menu");
    const root = createRootRoute({
      component: () => (
        <>
          <AccountMenuPanel />
          <SideWidget />
        </>
      ),
    });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router as AnyRouter} />
      </QueryClientProvider>,
    );
    const links = await screen.findAllByRole("link", { name: "Messages, 1 unread" });
    expect(links).toHaveLength(2); // the menu and the widget
    expect(m().state.rpcs.filter((r) => r.fn === "support_unread_counts")).toHaveLength(1);
    expect(m().realtime.channels).toHaveLength(0);
    const src = readFileSync(
      join(process.cwd(), "src/components/marketplace/side-widget.tsx"),
      "utf8",
    );
    expect(src).not.toMatch(/subscribeThreads|\.channel\(|setInterval|refetchInterval/);
  });

  it("labels stay on one line, and the pill grows with them (no fixed width)", () => {
    const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
    const rule = (sel: string) => {
      const start = css.indexOf(`\n${sel} {`);
      return start < 0 ? "" : css.slice(start, css.indexOf("}", start));
    };
    expect(rule(".side-widget-label")).toMatch(/white-space:\s*nowrap/);
    const btn = rule(".side-widget-btn");
    expect(btn).toMatch(/min-inline-size:\s*56px/);
    expect(btn).toMatch(/\binline-size:\s*auto/);
    expect(btn).not.toMatch(/[^-]inline-size:\s*\d/);
    expect(rule(".side-widget-label")).not.toMatch(/overflow-wrap/);
  });

  it("its texts exist in all 9 languages", () => {
    const json = (p: string) =>
      JSON.parse(readFileSync(join(process.cwd(), p), "utf8")) as Record<string, unknown>;
    for (const code of ["en", "es", "ar", "de", "he", "ko", "pt", "zh-Hans", "zh-Hant"]) {
      const sw = json(`src/locales/${code}/common.json`)["sideWidget"] as Record<string, string>;
      for (const key of ["label", "messages", "messagesUnread", "feedback", "top", "topLabel"])
        expect(sw[key], `${code}.${key}`).toBeTruthy();
      expect(sw["messagesUnread"], code).toContain("{{count}}");
      expect(sw["help"], code).toBeUndefined();
      expect(json(`src/locales/${code}/support.json`)["helpCenter"], code).toBeTruthy();
    }
  });

  it("Top appears only after scrolling about 400px, and goes back up", async () => {
    setScroll(0);
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    renderAt("/");
    const widget = await screen.findByTestId("side-widget");
    expect(within(widget).queryByRole("button", { name: "Back to top" })).toBeNull();
    act(() => {
      setScroll(399);
      window.dispatchEvent(new Event("scroll"));
    });
    await new Promise((r) => setTimeout(r, 40));
    expect(within(widget).queryByRole("button", { name: "Back to top" })).toBeNull();
    act(() => {
      setScroll(401);
      window.dispatchEvent(new Event("scroll"));
    });
    const top = await within(widget).findByRole("button", { name: "Back to top" });
    fireEvent.click(top);
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    vi.unstubAllGlobals();
  });

  it("respects reduced motion: jumps instead of scrolling", async () => {
    setScroll(900);
    const scrollTo = vi.fn();
    vi.stubGlobal("scrollTo", scrollTo);
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) => ({ matches: q.includes("reduce"), media: q }) as MediaQueryList,
    );
    renderAt("/");
    fireEvent.click(await screen.findByRole("button", { name: "Back to top" }));
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    vi.unstubAllGlobals();
  });

  it("speaks the page's language (Arabic)", async () => {
    renderAt("/", "ar");
    const widget = await screen.findByTestId("side-widget");
    expect(widget.getAttribute("aria-label")).toBe("الرسائل والملاحظات");
    expect(within(widget).getByRole("link", { name: "الرسائل" })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------
describe("feedback: validation and payload", () => {
  const base = { message: "The search is great.", email: "", path: "/", locale: "en" };

  it("3 to 2000 characters; a valid e-mail or none", () => {
    expect(feedbackIssues(base)).toEqual({});
    expect(feedbackIssues({ ...base, message: "  ab  " })).toEqual({ message: "tooShort" });
    expect(feedbackIssues({ ...base, message: "x".repeat(2001) })).toEqual({ message: "tooLong" });
    expect(feedbackIssues({ ...base, message: "x".repeat(2000) })).toEqual({});
    expect(feedbackIssues({ ...base, email: "nope" })).toEqual({ email: "badEmail" });
    expect(feedbackIssues({ ...base, email: "me@example.com" })).toEqual({});
  });

  it("only message, e-mail, pathname (no query or hash) and locale", () => {
    expect(pathOnly("/product/x?ref=mail&token=abc#reviews")).toBe("/product/x");
    expect(pathOnly("https://evil.example/x")).toBe("/");
    const args = toSubmitArgs({
      message: "  Lovely shop.  ",
      email: " me@example.com ",
      path: "/store/beta?utm=x#top",
      locale: "de",
    });
    expect(args).toEqual({
      p_message: "Lovely shop.",
      p_email: "me@example.com",
      p_path: "/store/beta",
      p_locale: "de",
    });
    expect(submitFeedbackArgsSchema.safeParse({ ...args, p_user_agent: "x" }).success).toBe(false);
    expect(toSubmitArgs({ ...base, email: "" }).p_email).toBeNull();
  });
});

describe("feedback dialog", () => {
  async function openDialog(path = "/products") {
    const router = renderAt(path);
    const trigger = await screen.findByRole("button", { name: "Feedback" });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole("dialog", { name: "Send us feedback" });
    return { router, trigger, dialog };
  }

  it("focus moves into the dialog, Esc closes it and focus returns to Feedback", async () => {
    const { trigger, dialog } = await openDialog();
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("inline messages, a counter, and the unsent draft survives closing", async () => {
    const { dialog } = await openDialog();
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));
    expect(await within(dialog).findByText("Write at least 3 characters.")).toBeTruthy();
    const box = within(dialog).getByLabelText("Your message");
    fireEvent.change(box, { target: { value: "Hello" } });
    expect(within(dialog).getByText("5 / 2000")).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText("E-mail (optional)"), {
      target: { value: "x@" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));
    expect(
      await within(dialog).findByText("Enter a valid e-mail address, or leave it empty."),
    ).toBeTruthy();
    expect(m().state.rpcs).toHaveLength(0);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Feedback" }));
    expect(((await screen.findByLabelText("Your message")) as HTMLTextAreaElement).value).toBe(
      "Hello",
    );
  });

  it("sends message, e-mail, the pathname and the locale only, then thanks", async () => {
    const { dialog } = await openDialog("/products?q=secret#x");
    fireEvent.change(within(dialog).getByLabelText("Your message"), {
      target: { value: "Please add more lamps." },
    });
    fireEvent.change(within(dialog).getByLabelText("E-mail (optional)"), {
      target: { value: "me@example.com" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));
    expect(await within(dialog).findByText("Thank you. We read every message.")).toBeTruthy();
    expect(m().state.rpcs).toEqual([
      {
        fn: "submit_site_feedback",
        args: {
          p_message: "Please add more lamps.",
          p_email: "me@example.com",
          p_path: "/products",
          p_locale: "en",
        },
      },
    ]);
  });

  it("the honeypot: pretend success, send nothing", async () => {
    const { dialog } = await openDialog();
    fireEvent.change(within(dialog).getByLabelText("Your message"), {
      target: { value: "Buy now!!!" },
    });
    const hp = dialog.querySelector<HTMLInputElement>('input[name="website"]')!;
    expect(hp.tabIndex).toBe(-1);
    expect(hp.closest("[aria-hidden='true']")).toBeTruthy();
    fireEvent.change(hp, { target: { value: "https://spam.example" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));
    expect(await within(dialog).findByText("Thank you. We read every message.")).toBeTruthy();
    expect(m().state.rpcs).toHaveLength(0);
  });

  it("the database's error text is shown as it is", async () => {
    const { dialog } = await openDialog();
    m().state.queue.push({
      error: { code: "P0001", message: "Too many messages. Please try again later." },
    });
    fireEvent.change(within(dialog).getByLabelText("Your message"), {
      target: { value: "Hello there" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "Too many messages. Please try again later.",
    );
  });

  it("a missing function shows the real error", async () => {
    const { dialog } = await openDialog();
    m().state.queue.push({
      error: {
        code: "PGRST202",
        message:
          "Could not find the function public.submit_site_feedback(p_email, p_locale, p_message, p_path) in the schema cache",
      },
    });
    fireEvent.change(within(dialog).getByLabelText("Your message"), {
      target: { value: "Hello there" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));
    expect((await within(dialog).findByRole("alert")).textContent).toContain(
      "Could not find the function public.submit_site_feedback",
    );
  });
});

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
const row = (patch: Partial<FeedbackRow> = {}): FeedbackRow => ({
  id: "11111111-2222-4333-8444-555555555555",
  user_id: "6f1c2b0a-4d3e-4f5a-9b8c-7d6e5f4a3b2c",
  contact_email: "me@example.com",
  message: "<b>Not bold</b> please add lamps",
  page_path: "/products",
  locale: "de",
  status: "new",
  handled_by: null,
  handled_at: null,
  created_at: "2026-11-15T10:00:00Z",
  ...patch,
});

describe("staff: feedback", () => {
  it("lists newest first, 25 per page, by status (the query itself)", async () => {
    m().state.queue.push({
      data: Array.from({ length: 26 }, (_, i) =>
        row({ id: `11111111-2222-4333-8444-${String(i).padStart(12, "0")}` }),
      ),
    });
    const r = await feedbackService.list("read", 1);
    expect(r.rows).toHaveLength(25);
    expect(r.hasMore).toBe(true);
    const calls = m().callsOn("site_feedback", 0);
    expect(calls).toEqual(
      expect.arrayContaining([
        ["eq", "status", "read"],
        ["order", "created_at", { ascending: false }],
        ["range", 25, 50],
      ]),
    );
  });

  function renderPanel() {
    return render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <FeedbackPanel />
      </QueryClientProvider>,
    );
  }

  it("New by default with counts; text shown safely; mailto; a short user id", async () => {
    vi.spyOn(feedbackService, "counts").mockResolvedValue({ new: 2, read: 5, archived: 1 });
    const list = vi
      .spyOn(feedbackService, "list")
      .mockResolvedValue({ rows: [row()], hasMore: false });
    renderPanel();
    const item = await screen.findByTestId("feedback-item");
    expect(list).toHaveBeenCalledWith("new", 0);
    expect(screen.getByRole("radio", { name: /New/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: /Read/ }).textContent).toContain("5");
    expect(item.querySelector("b")).toBeNull();
    expect(item.textContent).toContain("<b>Not bold</b> please add lamps");
    expect(within(item).getByRole("link", { name: "me@example.com" }).getAttribute("href")).toBe(
      "mailto:me@example.com",
    );
    expect(item.textContent).toContain("6f1c2b0a");
    expect(item.textContent).not.toContain("6f1c2b0a-4d3e");
    expect(item.textContent).toContain("/products");
    fireEvent.click(screen.getByRole("radio", { name: /Archived/ }));
    await waitFor(() => expect(list).toHaveBeenCalledWith("archived", 0));
  });

  it("actions per status call mark_site_feedback; errors shown as they are", async () => {
    vi.spyOn(feedbackService, "counts").mockResolvedValue({ new: 1, read: 0, archived: 0 });
    vi.spyOn(feedbackService, "list").mockResolvedValue({ rows: [row()], hasMore: true });
    renderPanel();
    const item = await screen.findByTestId("feedback-item");
    expect(
      within(item)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Mark read", "Archive"]);
    expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
    m().state.queue.push({ error: { code: "42501", message: "Only staff can change feedback." } });
    fireEvent.click(within(item).getByRole("button", { name: "Mark read" }));
    expect((await within(item).findByRole("alert")).textContent).toBe(
      "Only staff can change feedback. (42501)",
    );
    expect(m().state.rpcs.at(-1)).toEqual({
      fn: "mark_site_feedback",
      args: { p_id: row().id, p_status: "read" },
    });
  });

  it("read and archived items offer the other two moves", async () => {
    vi.spyOn(feedbackService, "counts").mockResolvedValue({ new: 0, read: 1, archived: 0 });
    vi.spyOn(feedbackService, "list").mockImplementation(async (s) => ({
      rows: [row({ status: s })],
      hasMore: false,
    }));
    renderPanel();
    fireEvent.click(await screen.findByRole("radio", { name: /Read/ }));
    await waitFor(() =>
      expect(
        within(screen.getByTestId("feedback-item"))
          .getAllByRole("button")
          .map((b) => b.textContent),
      ).toEqual(["Archive", "Mark new again"]),
    );
  });

  it("empty and real error states", async () => {
    vi.spyOn(feedbackService, "counts").mockRejectedValue({
      code: "PGRST205",
      message: "Could not find the table 'public.site_feedback' in the schema cache",
    });
    vi.spyOn(feedbackService, "list").mockRejectedValue({
      code: "PGRST205",
      message: "Could not find the table 'public.site_feedback' in the schema cache",
    });
    renderPanel();
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.map((a) => a.textContent).join(" ")).toContain(
      "Could not find the table 'public.site_feedback' in the schema cache (PGRST205)",
    );
  });

  it("is in the Admin and Marketplace panels", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    for (const p of ["src/routes/admin.tsx", "src/routes/admin_.marketplace.tsx"]) {
      expect(read(p), p).toContain('["feedback", "Feedback"]');
      expect(read(p), p).toContain("<FeedbackPanel />");
    }
  });
});

describe("privacy: no tracking or storage", () => {
  it("uses no cookies, browser storage or analytics", () => {
    for (const f of [
      "src/components/marketplace/side-widget.tsx",
      "src/services/feedback.ts",
      "src/lib/side-widget.ts",
      "src/components/staff/feedback-panel.tsx",
    ]) {
      const src = readFileSync(join(process.cwd(), f), "utf8");
      expect(src, f).not.toMatch(
        /document\.cookie|localStorage|sessionStorage|indexedDB|sendBeacon|gtag|dataLayer|analytics|navigator\.userAgent|location\.(search|hash|href)/,
      );
    }
  });
});
