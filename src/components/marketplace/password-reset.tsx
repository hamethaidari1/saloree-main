import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useEffect, useRef, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { AuthCard } from "@/components/marketplace/auth-form";
import {
  cleanRecoveryUrl,
  cooldownLeft,
  fieldErrors,
  forgotPasswordSchema,
  isShownSendError,
  openRecoveryLink,
  PASSWORD_MIN_LENGTH,
  readSentAt,
  requestPasswordReset,
  resetErrorKind,
  resetPasswordSchema,
  saveSentAt,
  updatePassword,
  type InvalidReason,
  type RecoveryResult,
} from "@/lib/password-reset";

/** Focus the first field once the page is shown (no autoFocus attribute). */
function useFocusFirst<T extends HTMLElement>(when = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (when) ref.current?.focus();
  }, [when]);
  return ref;
}

function FieldError({ id, text }: { id: string; text: string | null }) {
  return text ? (
    <p id={id} className="auth-field-error">
      {text}
    </p>
  ) : null;
}

// ---------------------------------------------------------------------------
// /forgot-password
// ---------------------------------------------------------------------------
export function ForgotPasswordView() {
  const { t } = useTranslation("auth");
  const [busy, setBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const emailRef = useFocusFirst<HTMLInputElement>();

  // After hydration: a link requested in this tab a moment ago keeps its cooldown.
  useEffect(() => {
    const saved = readSentAt();
    if (saved && cooldownLeft(saved, Date.now()) > 0) setSentAt(saved);
  }, []);

  const left = cooldownLeft(sentAt, now);
  const counting = left > 0;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [counting]);

  const startCooldown = () => {
    const at = Date.now();
    saveSentAt(at);
    setSentAt(at);
    setNow(at);
  };

  return (
    <AuthCard
      title={t("forgot.title")}
      subtitle={t("forgot.subtitle")}
      submitLabel={left > 0 ? t("forgot.resendIn", { seconds: left }) : t("forgot.submit")}
      busy={busy}
      submitDisabled={left > 0}
      noValidate
      error={error}
      notice={
        sent ? (
          <>
            {t("forgot.sent")} <span className="auth-notice-hint">{t("forgot.sameBrowser")}</span>
          </>
        ) : null
      }
      onSubmit={async (form) => {
        if (busy || cooldownLeft(sentAt, Date.now()) > 0) return;
        setError(null);
        const parsed = forgotPasswordSchema.safeParse({ email: form.get("email") });
        if (!parsed.success) {
          const kind = fieldErrors(parsed.error)["email"];
          setEmailError(kind === "required" ? t("forgot.emailRequired") : t("forgot.emailInvalid"));
          emailRef.current?.focus();
          return;
        }
        setEmailError(null);
        setBusy(true);
        try {
          await requestPasswordReset(parsed.data.email);
          setSent(true);
          startCooldown();
        } catch (e) {
          const kind = resetErrorKind(e);
          if (isShownSendError(kind)) {
            setSent(false);
            setError(
              kind === "rateLimit" ? t("forgot.rateLimited") : t("db.network", { ns: "errors" }),
            );
            if (kind === "rateLimit") startCooldown();
          } else {
            // Anything else could depend on whether the account exists: same message.
            setSent(true);
            startCooldown();
          }
        } finally {
          setBusy(false);
        }
      }}
      footer={<Link to="/login">{t("forgot.back")}</Link>}
    >
      <div>
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          ref={emailRef}
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          dir="ltr"
          required
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? "email-error" : undefined}
          onChange={() => emailError && setEmailError(null)}
        />
        <div aria-live="polite">
          <FieldError id="email-error" text={emailError} />
        </div>
      </div>
    </AuthCard>
  );
}

// ---------------------------------------------------------------------------
// /reset-password
// ---------------------------------------------------------------------------
type Phase = { phase: "checking" } | ({ phase: "done" } & RecoveryResult);

function invalidMessage(t: TFunction, reason: InvalidReason, detail?: string) {
  switch (reason) {
    case "otherBrowser":
      return t("reset.otherBrowser");
    case "noLink":
      return t("reset.noLink");
    case "sessionMissing":
      return t("reset.sessionMissing");
    case "rateLimit":
      return t("forgot.rateLimited");
    case "network":
      return t("db.network", { ns: "errors" });
    case "other":
      return detail ?? t("reset.expired");
    default:
      return t("reset.expired");
  }
}

function updateErrorMessage(t: TFunction, e: unknown): { text: string; detail: string | null } {
  const kind = resetErrorKind(e);
  const raw =
    e && typeof e === "object" && "message" in e && typeof e.message === "string"
      ? e.message
      : null;
  switch (kind) {
    case "samePassword":
      return { text: t("reset.samePassword"), detail: null };
    case "weakPassword":
      // Supabase's message lists the project's exact rule; keep it as a detail.
      return { text: t("reset.weakPassword"), detail: raw };
    case "leakedPassword":
      return { text: t("reset.leakedPassword"), detail: null };
    case "rateLimit":
      return { text: t("forgot.rateLimited"), detail: null };
    case "network":
      return { text: t("db.network", { ns: "errors" }), detail: null };
    default:
      return { text: raw ?? t("reset.failed"), detail: null };
  }
}

export function ResetPasswordView() {
  const { t } = useTranslation("auth");
  const router = useRouter();
  const [state, setState] = useState<Phase>({ phase: "checking" });
  const started = useRef(false);

  useEffect(() => {
    // The link is processed once (React may run effects twice in development).
    if (started.current) return;
    started.current = true;
    const href = window.location.href;
    openRecoveryLink(href)
      .catch((e: unknown): RecoveryResult => ({
        status: "invalid",
        reason: resetErrorKind(e) ?? "other",
        ...(e instanceof Error ? { detail: e.message } : {}),
      }))
      .then((result) => {
        // Never leave a one-time code or an error in the address bar.
        const clean = cleanRecoveryUrl(href);
        if (
          clean !== `${window.location.pathname}${window.location.search}` ||
          window.location.hash
        )
          window.history.replaceState(window.history.state, "", clean);
        setState({ phase: "done", ...result });
      });
  }, []);

  if (state.phase === "checking")
    return (
      <main className="market-container auth-page">
        <div className="auth-card" aria-busy="true">
          <p className="oauth-status" role="status">
            <Loader2 className="animate-spin" aria-hidden="true" />
            {t("reset.checking")}
          </p>
        </div>
      </main>
    );

  if (state.status === "invalid")
    return <InvalidLink message={invalidMessage(t, state.reason, state.detail)} />;

  return (
    <NewPasswordForm
      email={state.email}
      onExpired={() => setState({ phase: "done", status: "invalid", reason: "sessionMissing" })}
      onDone={() =>
        router.navigate({ to: "/login", search: { notice: "password-updated" }, replace: true })
      }
    />
  );
}

function InvalidLink({ message }: { message: string }) {
  const { t } = useTranslation("auth");
  const ref = useFocusFirst<HTMLHeadingElement>();
  return (
    <main className="market-container auth-page">
      <div className="auth-card">
        <h1 className="page-title" tabIndex={-1} ref={ref}>
          {t("reset.invalidTitle")}
        </h1>
        <p role="alert" className="auth-error auth-error-block">
          {message}
        </p>
        <Button asChild className="w-full h-11">
          <Link to="/forgot-password">{t("reset.requestNew")}</Link>
        </Button>
        <div className="auth-footer">
          <Link to="/login">{t("reset.back")}</Link>
        </div>
      </div>
    </main>
  );
}

function NewPasswordForm({
  email,
  onExpired,
  onDone,
}: {
  email: string | null;
  onExpired: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation("auth");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{
    password?: string | undefined;
    confirm?: string | undefined;
  }>({});
  const [error, setError] = useState<{ text: string; detail: string | null } | null>(null);
  const passwordRef = useFocusFirst<HTMLInputElement>();
  const confirmRef = useRef<HTMLInputElement>(null);

  const fieldText = (kind: string | undefined) =>
    kind === "required"
      ? t("reset.passwordRequired")
      : kind === "tooShort"
        ? t("reset.passwordShort", { min: PASSWORD_MIN_LENGTH })
        : kind === "mismatch"
          ? t("reset.mismatch")
          : undefined;

  const describedBy = (field: "password" | "confirm") =>
    [field === "password" ? "password-hint" : null, errors[field] ? `${field}-error` : null]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <AuthCard
      title={t("reset.title")}
      subtitle={email ? t("reset.subtitle", { email }) : t("reset.subtitleNoEmail")}
      submitLabel={t("reset.submit")}
      busy={busy}
      noValidate
      error={
        error ? (
          <>
            <p>{error.text}</p>
            {error.detail && (
              <p className="oauth-error-code" dir="ltr">
                <bdi>{error.detail}</bdi>
              </p>
            )}
          </>
        ) : null
      }
      onSubmit={async (form) => {
        if (busy) return;
        setError(null);
        const parsed = resetPasswordSchema.safeParse({
          password: String(form.get("password") ?? ""),
          confirm: String(form.get("confirm") ?? ""),
        });
        if (!parsed.success) {
          const f = fieldErrors(parsed.error);
          setErrors({ password: fieldText(f["password"]), confirm: fieldText(f["confirm"]) });
          (f["password"] ? passwordRef : confirmRef).current?.focus();
          return;
        }
        setErrors({});
        setBusy(true);
        try {
          await updatePassword(parsed.data);
          onDone();
        } catch (e) {
          const kind = resetErrorKind(e);
          if (kind === "sessionMissing" || kind === "linkExpired") return onExpired();
          setError(updateErrorMessage(t, e));
          setBusy(false);
        }
      }}
      footer={<Link to="/login">{t("reset.back")}</Link>}
    >
      <div>
        <Label htmlFor="password">{t("reset.newPassword")}</Label>
        <Input
          ref={passwordRef}
          id="password"
          name="password"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={describedBy("password")}
        />
        <p id="password-hint" className="auth-field-hint">
          {t("reset.hint", { min: PASSWORD_MIN_LENGTH })}
        </p>
        <div aria-live="polite">
          <FieldError id="password-error" text={errors.password ?? null} />
        </div>
      </div>
      <div>
        <Label htmlFor="confirm">{t("reset.confirm")}</Label>
        <Input
          ref={confirmRef}
          id="confirm"
          name="confirm"
          type={show ? "text" : "password"}
          autoComplete="new-password"
          required
          aria-invalid={errors.confirm ? true : undefined}
          aria-describedby={describedBy("confirm")}
        />
        <div aria-live="polite">
          <FieldError id="confirm-error" text={errors.confirm ?? null} />
        </div>
      </div>
      <button
        type="button"
        className="auth-show-toggle"
        aria-controls="password confirm"
        onClick={() => setShow((s) => !s)}
      >
        {show ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        {show ? t("reset.hide") : t("reset.show")}
      </button>
    </AuthCard>
  );
}
