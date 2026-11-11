import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthCard } from "@/components/marketplace/auth-form";
import { safeRedirect, signIn } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): { redirect?: string } =>
    typeof s["redirect"] === "string" ? { redirect: s["redirect"] } : {},
  head: () => ({
    meta: [
      { title: "Sign in — Saloree" },
      { name: "description", content: "Sign in to your Saloree account." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { redirect } = Route.useSearch();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to see your orders or manage your store."
      submitLabel="Sign in"
      busy={busy}
      error={error}
      onSubmit={async (form) => {
        setBusy(true);
        setError(null);
        try {
          const { roles } = await signIn(String(form.get("email")), String(form.get("password")));
          const home = roles.includes("seller") ? "/seller" : "/account";
          router.history.push(safeRedirect(redirect, home));
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not sign in.");
          setBusy(false);
        }
      }}
      footer={
        <>
          New to Saloree? <Link to="/register">Create an account</Link>
        </>
      }
    >
      <div>
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
    </AuthCard>
  );
}
