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
  children,
}: {
  title: string;
  subtitle: string;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (form: FormData) => void;
  footer: ReactNode;
  /** "Continue with Google" + "or" divider, shown above the email form. */
  oauth?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <main className="market-container auth-page">
      <form
        className="auth-card"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          onSubmit(new FormData(e.currentTarget));
        }}
      >
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{subtitle}</p>
        {oauth}
        <div className="auth-fields">{children}</div>
        {error && (
          <p role="alert" className="auth-error">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full h-11" disabled={busy}>
          {busy ? t("pleaseWait") : submitLabel}
        </Button>
        <div className="auth-footer">{footer}</div>
      </form>
    </main>
  );
}
