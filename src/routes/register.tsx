import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthCard } from "@/components/marketplace/auth-form";
import { signUp, type SignupRole } from "@/lib/auth";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Create an account — Saloree" },
      { name: "description", content: "Join Saloree as a shopper or open your own store." },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const router = useRouter();
  const [role, setRole] = useState<SignupRole>("customer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (sentTo)
    return (
      <main className="market-container auth-page">
        <div className="auth-card">
          <h1 className="page-title">Check your inbox</h1>
          <p className="page-subtitle">
            We sent a confirmation link to {sentTo}. Open it, then <Link to="/login">sign in</Link>.
          </p>
        </div>
      </main>
    );

  return (
    <AuthCard
      title="Create your account"
      subtitle="Shop independent stores, or open one of your own."
      submitLabel={role === "seller" ? "Create seller account" : "Create account"}
      busy={busy}
      error={error}
      onSubmit={async (form) => {
        const password = String(form.get("password"));
        if (password.length < 8) return setError("Use at least 8 characters for your password.");
        setBusy(true);
        setError(null);
        const email = String(form.get("email"));
        try {
          const { needsConfirmation } = await signUp({
            email,
            password,
            fullName: String(form.get("fullName")).trim(),
            role,
          });
          if (needsConfirmation) setSentTo(email);
          else router.history.push(role === "seller" ? "/seller" : "/account");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Could not create your account.");
        } finally {
          setBusy(false);
        }
      }}
      footer={
        <>
          Already have an account? <Link to="/login">Sign in</Link>
        </>
      }
    >
      <fieldset className="auth-roles">
        <legend>I want to</legend>
        {(
          [
            ["customer", "Shop"],
            ["seller", "Sell"],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className={role === value ? "selected" : ""}>
            <input
              type="radio"
              name="role"
              value={value}
              checked={role === value}
              onChange={() => setRole(value)}
            />
            {label}
          </label>
        ))}
      </fieldset>
      <div>
        <Label htmlFor="fullName">Full name</Label>
        <Input id="fullName" name="fullName" autoComplete="name" required />
      </div>
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
          autoComplete="new-password"
          minLength={8}
          required
        />
      </div>
    </AuthCard>
  );
}
