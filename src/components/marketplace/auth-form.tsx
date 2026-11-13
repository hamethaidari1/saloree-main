import { useTranslation } from "react-i18next";
import type { FormEvent, ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth";

export function SignOutButton() {
  const { t } = useTranslation("account");
  const router = useRouter();
  return (
    <Button
      variant="outline"
      onClick={async () => {
        try {
          await signOut();
          router.history.push("/");
        } catch {
          toast.error(t("signOutFailed"));
        }
      }}
    >
      {t("signOut")}
    </Button>
  );
}

export function AuthCard({
  title,
  subtitle,
  submitLabel,
  busy,
  error,
  onSubmit,
  footer,
  oauth,
  notice,
  submitDisabled = false,
  noValidate = false,
  children,
}: {
  title: string;
  subtitle: string;
  submitLabel: string;
  busy: boolean;
  error: ReactNode;
  onSubmit: (form: FormData) => void;
  footer: ReactNode;
  /** "Continue with Google" + "or" divider, shown above the email form. */
  oauth?: ReactNode;
  /** A polite status message above the fields (e.g. "Password updated"). */
  notice?: ReactNode;
  /** Disabled for a reason other than sending (e.g. a resend cooldown). */
  submitDisabled?: boolean;
  /** Skip the browser's own checks when the page validates with zod. */
  noValidate?: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <main className="market-container auth-page">
      <form
        className="auth-card"
        noValidate={noValidate}
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          onSubmit(new FormData(e.currentTarget));
        }}
      >
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{subtitle}</p>
        {oauth}
        <div role="status" aria-live="polite" className="auth-notice-slot">
          {notice && <p className="auth-notice">{notice}</p>}
        </div>
        <div className="auth-fields">{children}</div>
        {/* Always in the page, so screen readers announce a new error. */}
        <div role="alert" aria-live="assertive" className="auth-error-slot">
          {error && <div className="auth-error">{error}</div>}
        </div>
        <Button type="submit" className="w-full h-11" disabled={busy || submitDisabled}>
          {busy ? t("pleaseWait") : submitLabel}
        </Button>
        <div className="auth-footer">{footer}</div>
      </form>
    </main>
  );
}
