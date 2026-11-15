import { useEffect, useId, useState, type FormEvent } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronUp, MessageSquare, SquarePen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useLocale } from "@/i18n/hooks";
import { showsSideWidget, TOP_AFTER_PX } from "@/lib/side-widget";
import {
  FEEDBACK_MAX,
  FEEDBACK_MIN,
  feedbackIssues,
  feedbackService,
  type FeedbackIssue,
  type FeedbackIssues,
} from "@/services/feedback";

function scrollToTop() {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  // The Top button disappears up there: keyboard users continue from the header.
  document.querySelector<HTMLElement>("header a[href]")?.focus({ preventScroll: true });
}

function useScrolledPast(px: number) {
  const [past, setPast] = useState(false);
  useEffect(() => {
    let frame = 0;
    const check = () => {
      frame = 0;
      setPast(window.scrollY > px);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(check);
    };
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [px]);
  return past;
}

/** The unsent draft: kept in memory only (never in browser storage). */
interface Draft {
  message: string;
  email: string;
  website: string;
}
const EMPTY_DRAFT: Draft = { message: "", email: "", website: "" };

function FeedbackForm({
  draft,
  setDraft,
  pathname,
  onSent,
}: {
  draft: Draft;
  setDraft: (d: Draft) => void;
  pathname: string;
  onSent: () => void;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const id = useId();
  const [issues, setIssues] = useState<FeedbackIssues>({});
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const issueText = (i: FeedbackIssue) =>
    t(`sideWidget.${i}`, { min: FEEDBACK_MIN, max: FEEDBACK_MAX });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFailure(null);
    // A filled honeypot is a bot: pretend it worked and send nothing.
    if (draft.website.trim()) return onSent();
    const input = { message: draft.message, email: draft.email, path: pathname, locale };
    const found = feedbackIssues(input);
    setIssues(found);
    if (Object.keys(found).length) {
      document.getElementById(`${id}-${found.message ? "message" : "email"}`)?.focus();
      return;
    }
    setSending(true);
    try {
      await feedbackService.submit(input);
      onSent();
    } catch (err) {
      // The database's own words (too short, bad e-mail, too many messages…).
      setFailure(err instanceof Error && err.message ? err.message : t("sideWidget.failed"));
    } finally {
      setSending(false);
    }
  };

  const count = draft.message.trim().length;
  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-message`} className="text-sm font-medium">
          {t("sideWidget.message")}
        </label>
        <Textarea
          id={`${id}-message`}
          rows={5}
          maxLength={FEEDBACK_MAX}
          value={draft.message}
          aria-invalid={!!issues.message}
          aria-describedby={`${id}-count${issues.message ? ` ${id}-message-error` : ""}`}
          onChange={(e) => {
            setDraft({ ...draft, message: e.target.value });
            setIssues((i) => ({ ...i, message: undefined }));
          }}
        />
        <p id={`${id}-count`} className="side-widget-count">
          {t("sideWidget.counter", { count, max: FEEDBACK_MAX })}
        </p>
        {issues.message && (
          <p id={`${id}-message-error`} className="seller-error">
            {issueText(issues.message)}
          </p>
        )}
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-email`} className="text-sm font-medium">
          {t("sideWidget.email")}
        </label>
        <Input
          id={`${id}-email`}
          type="email"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          value={draft.email}
          aria-invalid={!!issues.email}
          aria-describedby={`${id}-email-hint${issues.email ? ` ${id}-email-error` : ""}`}
          onChange={(e) => {
            setDraft({ ...draft, email: e.target.value });
            setIssues((i) => ({ ...i, email: undefined }));
          }}
        />
        <p id={`${id}-email-hint`} className="side-widget-count">
          {t("sideWidget.emailHint")}
        </p>
        {issues.email && (
          <p id={`${id}-email-error`} className="seller-error">
            {issueText(issues.email)}
          </p>
        )}
      </div>
      {/* Honeypot: invisible to people and to screen readers, filled only by bots. */}
      <div className="side-widget-hp" aria-hidden="true">
        <label htmlFor={`${id}-website`}>{t("sideWidget.honeypot")}</label>
        <input
          id={`${id}-website`}
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={draft.website}
          onChange={(e) => setDraft({ ...draft, website: e.target.value })}
        />
      </div>
      <p className="side-widget-count">{t("sideWidget.sentWith")}</p>
      <div role="alert">
        {failure && (
          <p className="seller-error">
            {t("sideWidget.failed")} {failure}
          </p>
        )}
      </div>
      <Button type="submit" disabled={sending}>
        {sending ? t("sideWidget.sending") : t("sideWidget.send")}
      </Button>
    </form>
  );
}

/**
 * Help · Feedback · Top, fixed at the inline-end edge (left in RTL). Hidden on
 * checkout, sign-in, dashboards and the order confirmation. No tracking.
 */
export function SideWidget() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (!showsSideWidget(pathname)) return null;
  return <SideWidgetBar pathname={pathname} />;
}

function SideWidgetBar({ pathname }: { pathname: string }) {
  const { t } = useTranslation();
  const past = useScrolledPast(TOP_AFTER_PX);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  return (
    <aside className="side-widget" aria-label={t("sideWidget.label")} data-testid="side-widget">
      <Link
        to="/help"
        className="side-widget-btn side-widget-help"
        title={t("sideWidget.helpTitle")}
      >
        <MessageSquare aria-hidden />
        <span className="side-widget-label">{t("sideWidget.help")}</span>
      </Link>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          // After a successful send, the next opening starts empty.
          if (!o && sent) {
            setSent(false);
            setDraft(EMPTY_DRAFT);
          }
        }}
      >
        <DialogTrigger asChild>
          <button type="button" className="side-widget-btn side-widget-feedback">
            <SquarePen aria-hidden />
            <span className="side-widget-label">{t("sideWidget.feedback")}</span>
          </button>
        </DialogTrigger>
        <DialogContent closeLabel={t("sideWidget.close")}>
          <DialogHeader>
            <DialogTitle>{t("sideWidget.dialogTitle")}</DialogTitle>
            <DialogDescription>{t("sideWidget.dialogText")}</DialogDescription>
          </DialogHeader>
          {sent ? (
            <div className="grid gap-4">
              <p role="status" className="side-widget-thanks">
                {t("sideWidget.thanks")}
              </p>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t("sideWidget.close")}
              </Button>
            </div>
          ) : (
            <FeedbackForm
              draft={draft}
              setDraft={setDraft}
              pathname={pathname}
              onSent={() => setSent(true)}
            />
          )}
        </DialogContent>
      </Dialog>

      {past && (
        <button
          type="button"
          className="side-widget-btn side-widget-top"
          aria-label={t("sideWidget.topLabel")}
          onClick={scrollToTop}
        >
          <ChevronUp aria-hidden />
          <span className="side-widget-label" aria-hidden>
            {t("sideWidget.top")}
          </span>
        </button>
      )}
    </aside>
  );
}
