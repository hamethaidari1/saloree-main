import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ImagePlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ConfirmDialog, type ConfirmRequest } from "@/components/marketplace/confirm-dialog";
import { intlLocale, type Locale } from "@/i18n/locales";
import {
  ATTACHMENT_ACCEPT,
  attachmentProblem,
  groupByDay,
  linkify,
  MESSAGE_MAX,
  relativeDay,
  type SenderRole,
} from "@/lib/support";
import {
  supportErrorText,
  supportKeys,
  supportService,
  type SupportMessage,
  type SupportThread,
} from "@/services/support";
import { useSupportText, type SupportAudience, type SupportT } from "./support-text";
import { senderLabel, stillPending, useSender } from "./sender";
import { refreshSupport, setActiveThread, useThreadMessages } from "./use-support";

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------
/** Plain text; http(s) addresses become links that open in a new tab. */
export function MessageText({ text }: { text: string }) {
  return (
    <p className="support-text" dir="auto">
      {linkify(text).map((part, i) =>
        part.type === "link" ? (
          <a key={i} href={part.href} target="_blank" rel="noopener noreferrer nofollow">
            {part.value}
          </a>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </p>
  );
}

/** A private image: a 60-second signed link, created when it is shown. */
function AttachmentImage({ path, alt, t }: { path: string; alt: string; t: SupportT }) {
  const [open, setOpen] = useState(false);
  const url = useQuery({
    queryKey: supportKeys.attachment(path),
    queryFn: () => supportService.attachmentUrl(path),
    staleTime: 45_000,
    gcTime: 55_000,
    retry: false,
  });
  if (url.isError)
    return (
      <p className="seller-error" role="alert">
        {t("imageError")}
      </p>
    );
  return (
    <>
      <button
        type="button"
        className="support-image"
        aria-label={`${t("enlarge")}: ${alt}`}
        disabled={!url.data}
        onClick={() => {
          if (url.isStale) void url.refetch();
          setOpen(true);
        }}
      >
        {url.data ? <img src={url.data} alt={alt} loading="lazy" /> : <span aria-hidden />}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="support-image-dialog" closeLabel={t("close")}>
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          {url.data && <img src={url.data} alt={alt} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

const timeFormat = (locale: Locale) =>
  new Intl.DateTimeFormat(intlLocale(locale), { timeStyle: "short" });
const dayFormat = (locale: Locale) =>
  new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "medium" });

/** "Today" / "Yesterday" / a date, for the separators. */
function dayLabel(day: string, t: SupportT, locale: Locale) {
  const rel = relativeDay(day);
  if (rel) return t(rel);
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return dayFormat(locale).format(new Date(y, m - 1, d));
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------
function Composer({
  t,
  disabled,
  onSend,
  inputRef,
}: {
  t: SupportT;
  disabled: boolean;
  onSend: (body: string, file: File | null) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const canSend = !disabled && (!!body.trim() || !!file);

  const submit = () => {
    if (!canSend) return;
    onSend(body, file);
    setBody("");
    setFile(null);
    setProblem(null);
    inputRef.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter (and Enter while composing, e.g. Chinese input) is a new line.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  return (
    <form
      className="support-composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor="support-composer" className="sr-only">
        {t("composerLabel")}
      </label>
      <textarea
        id="support-composer"
        ref={inputRef}
        rows={2}
        maxLength={MESSAGE_MAX}
        value={body}
        placeholder={t("composerLabel")}
        aria-describedby="support-composer-hint"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKey}
      />
      <p id="support-composer-hint" className="support-hint">
        {t("composerHint")}
        {body.length > MESSAGE_MAX - 400 && ` ${body.length} / ${MESSAGE_MAX}`}
      </p>
      {file && (
        <p className="support-attached">
          <span dir="auto">{t("attached", { name: file.name })}</span>
          <button type="button" aria-label={t("removeAttachment")} onClick={() => setFile(null)}>
            <X size={14} aria-hidden />
          </button>
        </p>
      )}
      {problem && (
        <p className="seller-error" role="alert">
          {problem}
        </p>
      )}
      <div className="support-composer-actions">
        <input
          ref={fileInput}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          accept={ATTACHMENT_ACCEPT}
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (!f) return;
            const issue = attachmentProblem(f);
            setProblem(issue ? t(issue) : null);
            if (!issue) setFile(f);
          }}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("attach")}
          title={t("attach")}
          onClick={() => fileInput.current?.click()}
        >
          <ImagePlus aria-hidden />
        </Button>
        <Button type="submit" disabled={!canSend}>
          {disabled ? t("sending") : t("send")}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// The conversation
// ---------------------------------------------------------------------------
const NEAR_BOTTOM_PX = 48;

export function ConversationView({
  thread,
  viewer,
  audience,
  customerName,
  orderLink,
  onBack,
  onStartNew,
  extraActions,
  headingRef,
}: {
  thread: SupportThread;
  /** Whose side the reader is on. */
  viewer: SenderRole;
  audience: SupportAudience;
  /** Staff: the customer's name or e-mail, when readable. */
  customerName?: string | null | undefined;
  /** Staff: a link to the order in the panel. */
  orderLink?: ReactNode;
  /** Phones: back to the list. */
  onBack?: (() => void) | undefined;
  onStartNew?: (() => void) | undefined;
  /** Staff: Close / Reopen. */
  extraActions?: ReactNode;
  headingRef?: RefObject<HTMLHeadingElement | null> | undefined;
}) {
  const { t, locale } = useSupportText(audience);
  const qc = useQueryClient();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  const [pill, setPill] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [closing, setClosing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const other: SenderRole = viewer === "user" ? "staff" : "user";

  const markRead = useCallback(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    void supportService
      .markRead(thread.id)
      .then(() => refreshSupport(qc))
      .catch(() => undefined); // reading is best effort; the badge simply stays
  }, [thread.id, qc]);

  const messages = useThreadMessages(thread.id, (m) => {
    if (m.sender_role !== other) return;
    // Polite, and only who wrote: the text itself is on screen.
    setAnnounce(viewer === "user" ? t("newMessageFromTeam") : "New message from the customer");
    markRead();
  });
  const sender = useSender(thread.id);
  const list = messages.data ?? [];
  const pending = stillPending(sender.pending, list);

  // This conversation is on screen: no toast for it; read on open and on return.
  useEffect(() => {
    setActiveThread(thread.id);
    markRead();
    const onVisible = () => document.visibilityState === "visible" && markRead();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      setActiveThread(null);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [thread.id, markRead]);

  // Newest at the bottom: follow it, unless the reader scrolled up.
  const count = list.length + pending.length;
  const lastIsMine =
    pending.length > 0 || (list.length > 0 && list[list.length - 1]!.sender_role === viewer);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (nearBottom.current || lastIsMine) {
      el.scrollTop = el.scrollHeight;
      setPill(false);
    } else setPill(true);
  }, [count, lastIsMine]);
  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottom.current) setPill(false);
  };
  const toBottom = () => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    nearBottom.current = true;
    setPill(false);
  };

  const closed = thread.status === "closed";
  const time = timeFormat(locale);
  const closeThread = async () => {
    setClosing(true);
    setActionError(null);
    try {
      await supportService.setStatus(thread.id, "closed");
      await refreshSupport(qc);
    } catch (e) {
      setActionError(supportErrorText(e));
    } finally {
      setClosing(false);
    }
  };

  return (
    <section className="support-conversation" aria-labelledby={`support-subject-${thread.id}`}>
      <header className="support-conv-head">
        {onBack && (
          <Button variant="ghost" size="sm" className="support-back" onClick={onBack}>
            <ArrowLeft className="rtl:-scale-x-100" aria-hidden />
            {t("back")}
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <h2 id={`support-subject-${thread.id}`} ref={headingRef} tabIndex={-1} dir="auto">
            {thread.subject}
          </h2>
          <p className="support-conv-meta">
            <Badge variant="secondary">{t(`topic.${thread.topic}`)}</Badge>
            <Badge variant={closed ? "outline" : "default"}>{t(`status.${thread.status}`)}</Badge>
            {thread.order_id &&
              (orderLink ?? <span>{t("orderRef", { id: thread.order_id.slice(0, 8) })}</span>)}
          </p>
        </div>
        <div className="support-conv-actions">
          {extraActions}
          {viewer === "user" && !closed && (
            <Button
              variant="outline"
              size="sm"
              disabled={closing}
              onClick={() =>
                setConfirm({
                  title: t("closeTitle"),
                  description: t("closeText"),
                  confirmLabel: t("closeConversation"),
                  cancelLabel: t("cancel"),
                  run: closeThread,
                })
              }
            >
              {t("closeConversation")}
            </Button>
          )}
        </div>
      </header>
      {actionError && (
        <p className="seller-error" role="alert">
          {actionError}
        </p>
      )}
      {viewer === "user" && !closed && <p className="support-hint">{t("replyNote")}</p>}

      <div className="support-log-wrap">
        <div
          ref={listRef}
          className="support-log"
          tabIndex={0}
          aria-label={t("conversation")}
          onScroll={onScroll}
          data-testid="support-log"
        >
          {messages.isPending ? (
            <div className="seller-skeleton" aria-busy="true" aria-label="Loading">
              <div />
            </div>
          ) : messages.isError ? (
            <div role="alert" className="seller-empty">
              <p>{supportErrorText(messages.error)}</p>
              <Button variant="outline" size="sm" onClick={() => void messages.refetch()}>
                {t("tryAgain")}
              </Button>
            </div>
          ) : !list.length && !pending.length ? (
            <p className="support-hint">{t("noMessages")}</p>
          ) : (
            groupByDay(list).map((g) => (
              <section key={g.day} aria-label={dayLabel(g.day, t, locale)}>
                <h3 className="support-day">
                  <span>{dayLabel(g.day, t, locale)}</span>
                </h3>
                <ol className="support-messages">
                  {g.messages.map((m) => {
                    const who = senderLabel(m.sender_role, viewer, t, customerName);
                    return (
                      <li
                        key={m.id}
                        className="support-msg"
                        data-side={m.sender_role === viewer ? "mine" : "theirs"}
                        data-testid="support-message"
                      >
                        <p className="support-msg-head">
                          <strong>{who}</strong>{" "}
                          <time dateTime={m.created_at}>{time.format(new Date(m.created_at))}</time>
                        </p>
                        {m.body && <MessageText text={m.body} />}
                        {m.attachment_path && (
                          <AttachmentImage
                            path={m.attachment_path}
                            alt={t("imageAlt", { sender: who })}
                            t={t}
                          />
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))
          )}
          {pending.length > 0 && (
            <ol className="support-messages">
              {pending.map((p) => (
                <li
                  key={p.clientId}
                  className="support-msg"
                  data-side="mine"
                  data-state={p.status}
                  data-testid="support-pending"
                >
                  <p className="support-msg-head">
                    <strong>{senderLabel(viewer, viewer, t)}</strong>{" "}
                    <span>{p.status === "sending" ? t("sending") : t("failed")}</span>
                  </p>
                  {p.body && <MessageText text={p.body} />}
                  {p.file && <p className="support-hint">{t("previewImage")}</p>}
                  {p.status === "failed" && (
                    <div className="support-failed" role="alert">
                      <span>
                        {t("sendError")} {p.error}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => sender.retry(p.clientId)}>
                        {t("retry")}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("removeAttachment")}
                        onClick={() => sender.discard(p.clientId)}
                      >
                        <X aria-hidden />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
        {pill && (
          <button type="button" className="support-pill" onClick={toBottom}>
            <ArrowDown size={14} aria-hidden />
            {t("newMessages")}
          </button>
        )}
      </div>
      {/* Announces a new message from the other side, politely. */}
      <p className="sr-only" aria-live="polite" data-testid="support-announce">
        {announce}
      </p>

      {closed ? (
        <div className="support-closed">
          <p>{t("closedNote")}</p>
          {onStartNew && (
            <Button variant="outline" size="sm" onClick={onStartNew}>
              {t("startNew")}
            </Button>
          )}
        </div>
      ) : (
        <Composer
          t={t}
          disabled={sender.sending}
          inputRef={inputRef}
          onSend={(body, file) => void sender.send(body, file)}
        />
      )}
      <ConfirmDialog request={confirm} busy={closing} onClose={() => setConfirm(null)} />
    </section>
  );
}
