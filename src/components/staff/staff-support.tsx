import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConversationView } from "@/components/support/conversation";
import { UnreadBadge } from "@/components/support/notifier";
import { englishSupportT } from "@/components/support/support-text";
import { refreshSupport, useUnreadCounts } from "@/components/support/use-support";
import { useAuth } from "@/lib/auth";
import { isUnread, isWaitingForTeam, sortInbox, type ThreadStatus } from "@/lib/support";
import {
  supportErrorText,
  supportKeys,
  supportService,
  type SupportThread,
} from "@/services/support";

export type StaffPanelName = "admin" | "marketplace" | "finance";
type Filter = ThreadStatus | "all";

const FILTERS: [Filter, string][] = [
  ["open", "Open"],
  ["closed", "Closed"],
  ["all", "All"],
];

/** "Messages" + the staff unread count, for the panel's tab. */
export function StaffMessagesTabLabel() {
  const { user } = useAuth();
  const counts = useUnreadCounts(user?.id);
  const n = counts.data?.staff ?? 0;
  return (
    <>
      Messages
      <UnreadBadge count={n} />
      {n > 0 && <span className="sr-only">, {n} unread</span>}
    </>
  );
}

/** Close / Reopen (staff may reopen; the database decides). */
function StatusActions({ thread }: { thread: SupportThread }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = async (status: ThreadStatus) => {
    setBusy(true);
    setError(null);
    try {
      await supportService.setStatus(thread.id, status);
      await refreshSupport(qc);
    } catch (e) {
      setError(supportErrorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {thread.status === "open" ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void set("closed")}>
          Close
        </Button>
      ) : (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void set("open")}>
          Reopen
        </Button>
      )}
      {error && (
        <span className="seller-error" role="alert">
          {error}
        </span>
      )}
    </>
  );
}

function OrderLink({ panel, orderId }: { panel: StaffPanelName; orderId: string }) {
  const label = `Order #${orderId.slice(0, 8)}`;
  // Only Admin and Finance have an Orders tab; the Marketplace panel shows the number.
  if (panel === "admin")
    return (
      <Link to="/admin" search={{ tab: "orders" }} className="staff-link">
        {label}
      </Link>
    );
  if (panel === "finance")
    return (
      <Link to="/admin/finance" search={{ tab: "orders" }} className="staff-link">
        {label}
      </Link>
    );
  return <span>{label}</span>;
}

/** The support inbox for staff (admin, content_admin, finance_admin). */
export function StaffSupportPanel({ panel }: { panel: StaffPanelName }) {
  const t = englishSupportT();
  const [filter, setFilter] = useState<Filter>("open");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const threads = useQuery({
    queryKey: supportKeys.staff(filter),
    queryFn: () => supportService.allThreads(filter),
    retry: false,
  });
  const userIds = [...new Set((threads.data ?? []).map((x) => x.user_id))].sort();
  const people = useQuery({
    queryKey: supportKeys.people(userIds),
    queryFn: () => supportService.people(userIds),
    enabled: userIds.length > 0,
    retry: false,
  });
  const who = (userId: string) => {
    const p = people.data?.get(userId);
    return p?.name || p?.email || `User ${userId.slice(0, 8)}`;
  };
  const q = search.trim().toLowerCase();
  const shown = sortInbox(threads.data ?? []).filter(
    (x) =>
      !q ||
      x.subject.toLowerCase().includes(q) ||
      (people.data?.get(x.user_id)?.email ?? "").toLowerCase().includes(q),
  );
  const open = (threads.data ?? []).find((x) => x.id === openId) ?? null;
  const openThreadId = open?.id ?? null;
  useEffect(() => {
    if (openThreadId) heading.current?.focus();
  }, [openThreadId]);

  return (
    <section aria-labelledby="staff-support-heading">
      <div className="seller-panel-head">
        <div>
          <h2 id="staff-support-heading">Messages</h2>
          <p>
            Conversations with buyers and sellers. They see every reply as “Saloree team”, never
            your name.
          </p>
          {panel === "finance" && (
            <p className="support-warning" role="note">
              Payment and refund conversations are yours; every topic is listed here because the
              database doesn't filter by topic.
            </p>
          )}
        </div>
        <Input
          type="search"
          className="admin-search"
          placeholder={people.data?.size ? "Search subject or e-mail" : "Search subject"}
          aria-label="Search conversations"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div role="radiogroup" aria-label="Filter conversations" className="seller-segmented mb-4">
        {FILTERS.map(([f, label]) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={filter === f}
            onClick={() => {
              setFilter(f);
              setOpenId(null);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="support-inbox" data-view={open ? "detail" : "list"}>
        <div className="support-list">
          {threads.isPending ? (
            <div className="seller-skeleton" aria-busy="true" aria-label="Loading">
              <div />
              <div />
            </div>
          ) : threads.isError ? (
            <div role="alert" className="seller-empty">
              <h3>Conversations could not be loaded.</h3>
              <p>{supportErrorText(threads.error)}</p>
              <Button variant="outline" size="sm" onClick={() => void threads.refetch()}>
                Try again
              </Button>
            </div>
          ) : !shown.length ? (
            <p className="seller-hint">No conversations match.</p>
          ) : (
            <ul className="support-threads" aria-label="Conversations">
              {shown.map((x) => {
                const unread = isUnread(x, "staff");
                return (
                  <li key={x.id}>
                    <button
                      type="button"
                      className="support-thread"
                      aria-current={openId === x.id ? "true" : undefined}
                      data-unread={unread || undefined}
                      data-testid="staff-thread"
                      onClick={() => setOpenId(x.id)}
                    >
                      <span className="support-thread-top">
                        <span className="support-thread-subject" dir="auto">
                          {unread && <span className="support-dot" aria-hidden />}
                          {x.subject}
                        </span>
                        {x.last_message_at && (
                          <time dateTime={x.last_message_at}>
                            {new Date(x.last_message_at).toLocaleString()}
                          </time>
                        )}
                      </span>
                      <span className="support-thread-meta">
                        <Badge variant="secondary">{t(`topic.${x.topic}`)}</Badge>
                        {isWaitingForTeam(x) && <Badge>Waiting for us</Badge>}
                        {x.status === "closed" && <Badge variant="outline">Closed</Badge>}
                        <bdi>{who(x.user_id)}</bdi>
                        {unread && <span className="sr-only">, unread</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="support-detail">
          {open ? (
            <ConversationView
              key={open.id}
              thread={open}
              viewer="staff"
              audience="staff"
              customerName={who(open.user_id)}
              headingRef={heading}
              orderLink={
                open.order_id ? <OrderLink panel={panel} orderId={open.order_id} /> : undefined
              }
              extraActions={<StatusActions thread={open} />}
              onBack={() => setOpenId(null)}
            />
          ) : (
            <div className="support-placeholder">
              <p>Choose a conversation.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
