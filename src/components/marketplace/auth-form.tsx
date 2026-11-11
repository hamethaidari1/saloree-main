import type { FormEvent, ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth";

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      onClick={async () => {
        try {
          await signOut();
          router.history.push("/");
        } catch {
          toast.error("Could not sign out. Please try again.");
        }
      }}
    >
      Sign out
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
  children,
}: {
  title: string;
  subtitle: string;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (form: FormData) => void;
  footer: ReactNode;
  children: ReactNode;
}) {
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
        <div className="auth-fields">{children}</div>
        {error && (
          <p role="alert" className="auth-error">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full h-11" disabled={busy}>
          {busy ? "Please wait…" : submitLabel}
        </Button>
        <div className="auth-footer">{footer}</div>
      </form>
    </main>
  );
}
