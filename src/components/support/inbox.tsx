import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { intlLocale } from "@/i18n/locales";
import {
  isUnread,
  MESSAGE_MAX,
  SUBJECT_MAX,
  SUBJECT_MIN,
  SUPPORT_TOPICS,
  sortThreads,
  type SupportTopic,
} from "@/lib/support";
import {
  startThreadIssues,
  supportErrorText,
  supportKeys,
  supportService,
  type FormIssue,
  type SupportThread,
} from "@/services/support";
import type { InboxView } from "@/lib/support-search";
import { ConversationView } from "./conversation";
import { useSupportText, type SupportAudience, type SupportT } from "./support-text";
import { readSoundPref, refreshSupport, writeSoundPref } from "./use-support";

export interface OrderChoice {
  id: string;
  created_at: string;
}

function NewThreadForm({
  t,
  locale,
  audience,
  orders,
  initialOrderId,
  onCreated,
  onCancel,
}: {
  t: SupportT;
  locale: string;
  audience: SupportAudience;
  orders: OrderChoice[];
  initialOrderId: string | null;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  // Only an order from the list (the user's own, or their stores') can be referenced.
  const validOrder =
    initialOrderId && orders.some((o) => o.id === initialOrderId) ? initialOrderId : null;
  const [topic, setTopic] = useState<SupportTopic>(
    validOrder ? "order" : audience === "seller" ? "seller" : "other",
  );
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [orderId, setOrderId] = useState<string | null>(validOrder);
  const [issues, setIssues] = useState<Partial<Record<"subject" | "body", FormIssue>>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const date = new Intl.DateTimeFormat(intlLocale(locale as never), { dateStyle: "medium" });
  const issueText = (i: FormIssue) =>
    t(i, { min: SUBJECT_MIN, max: i.startsWith("subject") ? SUBJECT_MAX : MESSAGE_MAX });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const input = { topic, subject, body, orderId };
    const found = startThreadIssues(input);
    setIssues(found);
    if (Object.keys(found).length)
      return document
        .getElementById(found.subject ? "support-new-subject" : "support-new-body")
        ?.focus();
    setBusy(true);
    try {
      const id = await supportService.startThread(input);
      await refreshSupport(qc);
      onCreated(id);
    } catch (err) {
      // e.g. too many open conversations: the database's own words.
      setError(supportErrorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="support-conversation" aria-labelledby="support-new-title">
      <h2 id="support-new-title" ref={heading} tabIndex={-1}>
        {t("formTitle")}
      </h2>
      <form className="support-new" onSubmit={submit} noValidate>
        <p className="support-warning" role="note">
          {t("warning")}
        </p>
        <div className="seller-field">
          <label htmlFor="support-new-topic">{t("topicLabel")}</label>
          <select
            id="support-new-topic"
            className="seller-select"
            value={topic}
            onChange={(e) => setTopic(e.target.value as SupportTopic)}
          >
            {SUPPORT_TOPICS.map((tp) => (
              <option key={tp} value={tp}>
                {t(`topic.${tp}`)}
              </option>
            ))}
          </select>
        </div>
        {orders.length > 0 && (
          <div className="seller-field">
            <label htmlFor="support-new-order">{t("orderLabel")}</label>
            <select
              id="support-new-order"
              className="seller-select"
              value={orderId ?? ""}
              onChange={(e) => setOrderId(e.target.value || null)}
            >
              <option value="">{t("noOrder")}</option>
              {orders.map((o) => (
                <option key={o.id} value={o.id}>
                  {t("orderOption", {
                    id: o.id.slice(0, 8),
                    date: date.format(new Date(o.created_at)),
                  })}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="seller-field">
          <label htmlFor="support-new-subject">{t("subjectLabel")}</label>
          <Input
            id="support-new-subject"
            value={subject}
            maxLength={SUBJECT_MAX}
            aria-invalid={!!issues.subject}
            aria-describedby={issues.subject ? "support-new-subject-error" : undefined}
            onChange={(e) => setSubject(e.target.value)}
          />
          {issues.subject && (
            <p id="support-new-subject-error" className="seller-error">
              {issueText(issues.subject)}
            </p>
          )}
        </div>
        <div className="seller-field">
          <label htmlFor="support-new-body">{t("messageLabel")}</label>
          <Textarea
            id="support-new-body"
            rows={5}
            maxLength={MESSAGE_MAX}
            value={body}
            aria-invalid={!!issues.body}
            aria-describedby={issues.body ? "support-new-body-error" : undefined}
            onChange={(e) => setBody(e.target.value)}
          />
          {issues.body && (
            <p id="support-new-body-error" className="seller-error">
              {issueText(issues.body)}
            </p>
          )}
        </div>
        <div role="alert">{error && <p className="seller-error">{error}</p>}</div>
        <p className="support-hint">{t("replyNote")}</p>
        <div className="support-composer-actions">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? t("starting") : t("start")}
          </Button>
        </div>
      </form>
    </section>
  );
}

/**
 * The user's conversations with the Saloree team (customers at
 * /account/messages, sellers at /seller/support): list + live conversation.
 */
export function SupportInbox({
  audience,
  userId,
  orders,
  initial,
  onViewChange,
}: {
  audience: "customer" | "seller";
  userId: string;
  orders: OrderChoice[];
  initial: InboxView;
  /** Keeps the address bar in step (thread id only, never text). */
  onViewChange?: (view: InboxView) => void;
}) {
  const { t, locale } = useSupportText(audience);
  const [view, setViewState] = useState<InboxView>(initial);
  const [sound, setSound] = useState(false);
  useEffect(() => setSound(readSoundPref()), []);
  const heading = useRef<HTMLHeadingElement>(null);
  const listButtons = useRef(new Map<string, HTMLButtonElement>());
  const threads = useQuery({
    queryKey: supportKeys.mine(userId),
    queryFn: () => supportService.myThreads(userId),
    retry: false,
  });
  const ids = (threads.data ?? []).map((x) => x.id);
  const last = useQuery({
    queryKey: supportKeys.last(ids),
    queryFn: () => supportService.lastMessages(ids),
    enabled: ids.length > 0,
    retry: false,
  });
  const setView = (v: InboxView) => {
    setViewState(v);
    onViewChange?.(v);
  };
  const selected =
    view.kind === "thread" ? ((threads.data ?? []).find((x) => x.id === view.id) ?? null) : null;
  const time = new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "short",
    timeStyle: "short",
  });

  // Opening a conversation moves focus to its subject.
  const selectedId = selected?.id ?? null;
  useEffect(() => {
    if (selectedId) heading.current?.focus();
  }, [selectedId]);

  const back = () => {
    const id = view.kind === "thread" ? view.id : null;
    setView({ kind: "empty" });
    if (id) window.setTimeout(() => listButtons.current.get(id)?.focus(), 0);
  };

  const preview = (thread: SupportThread) => {
    const m = last.data?.get(thread.id);
    if (!m) return "";
    const text = m.body.trim() || (m.hasImage ? t("previewImage") : "");
    return text.length > 90 ? `${text.slice(0, 90)}…` : text;
  };

  return (
    <div className="support-inbox" data-view={view.kind === "empty" ? "list" : "detail"}>
      <aside className="support-list" aria-labelledby="support-list-title">
        <div className="support-list-head">
          <h2 id="support-list-title">{t("listLabel")}</h2>
          <Button size="sm" onClick={() => setView({ kind: "new", orderId: null })}>
            <MessageSquarePlus aria-hidden />
            {t("newConversation")}
          </Button>
        </div>
        <label className="support-sound">
          <input
            type="checkbox"
            checked={sound}
            onChange={(e) => {
              setSound(e.target.checked);
              writeSoundPref(e.target.checked);
            }}
          />
          {t("sound")}
        </label>
        {threads.isPending ? (
          <div className="seller-skeleton" aria-busy="true" aria-label="Loading">
            <div />
            <div />
          </div>
        ) : threads.isError ? (
          <div role="alert" className="seller-empty">
            <h3>{t("loadError")}</h3>
            <p>{supportErrorText(threads.error)}</p>
            <Button variant="outline" size="sm" onClick={() => void threads.refetch()}>
              {t("tryAgain")}
            </Button>
          </div>
        ) : !threads.data.length ? (
          <div className="seller-empty">
            <h3>{t("empty")}</h3>
            <p>{t("emptyText")}</p>
          </div>
        ) : (
          <ul className="support-threads">
            {sortThreads(threads.data).map((x) => {
              const unread = isUnread(x, "user");
              return (
                <li key={x.id}>
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) listButtons.current.set(x.id, el);
                      else listButtons.current.delete(x.id);
                    }}
                    className="support-thread"
                    aria-current={view.kind === "thread" && view.id === x.id ? "true" : undefined}
                    data-unread={unread || undefined}
                    data-testid="support-thread"
                    onClick={() => setView({ kind: "thread", id: x.id })}
                  >
                    <span className="support-thread-top">
                      <span className="support-thread-subject" dir="auto">
                        {unread && <span className="support-dot" aria-hidden />}
                        {x.subject}
                      </span>
                      {x.last_message_at && (
                        <time dateTime={x.last_message_at}>
                          {time.format(new Date(x.last_message_at))}
                        </time>
                      )}
                    </span>
                    <span className="support-thread-meta">
                      {t(`topic.${x.topic}`)} · {t(`status.${x.status}`)}
                      {unread && <span className="sr-only">, {t("unread")}</span>}
                    </span>
                    {preview(x) && (
                      <span className="support-thread-preview" dir="auto">
                        {preview(x)}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </aside>

      <div className="support-detail">
        {view.kind === "new" ? (
          <NewThreadForm
            t={t}
            locale={locale}
            audience={audience}
            orders={orders}
            initialOrderId={view.orderId}
            onCreated={(id) => setView({ kind: "thread", id })}
            onCancel={back}
          />
        ) : selected ? (
          <ConversationView
            key={selected.id}
            thread={selected}
            viewer="user"
            audience={audience}
            headingRef={heading}
            onBack={back}
            onStartNew={() => setView({ kind: "new", orderId: null })}
          />
        ) : (
          <div className="support-placeholder">
            <p>{t("subtitle")}</p>
            <p className="support-hint">{t("replyNote")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
