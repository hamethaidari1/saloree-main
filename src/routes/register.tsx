import { Trans, useTranslation } from "react-i18next";
import { headT } from "@/i18n/head";
import { errorKey, translateError } from "@/i18n/messages";
import { errorText } from "@/lib/oauth";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthCard } from "@/components/marketplace/auth-form";
import { GoogleButton } from "@/components/marketplace/google-button";
import { LegalConsent } from "@/components/legal/legal-links";
import { signUp, type SignupRole } from "@/lib/auth";
import { newPasswordSchema, PASSWORD_MIN_LENGTH } from "@/lib/password-reset";

export const Route = createFileRoute("/register")({
  // ?role=seller preselects "Sell" (used by "Sell on Saloree").
  validateSearch: (s: Record<string, unknown>): { role?: SignupRole } =>
    s["role"] === "seller" || s["role"] === "customer" ? { role: s["role"] } : {},
  head: ({ matches }) => ({
    meta: [
      { title: headT(matches, "auth")("register.metaTitle") },
      { name: "description", content: headT(matches, "auth")("register.metaDescription") },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const { t } = useTranslation("auth");
  const router = useRouter();
  const search = Route.useSearch();
  const [role, setRole] = useState<SignupRole>(search.role ?? "customer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (sentTo)
    return (
      <main className="market-container auth-page">
        <div className="auth-card">
          <h1 className="page-title">{t("register.inboxTitle")}</h1>
          <p className="page-subtitle">
            <Trans
              t={t}
              i18nKey="register.inboxText"
              values={{ email: sentTo }}
              components={{ 1: <Link to="/login" /> }}
            />
          </p>
        </div>
      </main>
    );

  return (
    <AuthCard
      title={t("register.title")}
      subtitle={t("register.subtitle")}
      submitLabel={role === "seller" ? t("register.submitSeller") : t("register.submit")}
      busy={busy}
      error={error}
      consent={<LegalConsent />}
      onSubmit={async (form) => {
        const password = String(form.get("password"));
        if (!newPasswordSchema.safeParse(password).success)
          return setError(t("register.passwordShort"));
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
          setError(errorKey(e) || errorText(e) ? translateError(t, e) : t("register.failed"));
        } finally {
          setBusy(false);
        }
      }}
      footer={
        <>
          <Trans t={t} i18nKey="register.have" components={{ 1: <Link to="/login" /> }} />
        </>
      }
      oauth={
        <>
          {/* Above the Google button: "Sell" makes Google sign-up a seller account too. */}
          <fieldset className="auth-roles">
            <legend>{t("register.iWant")}</legend>
            {(
              [
                ["customer", t("register.shop")],
                ["seller", t("register.sell")],
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
          <GoogleButton intent={role} />
        </>
      }
    >
      <div>
        <Label htmlFor="fullName">{t("fullName")}</Label>
        <Input id="fullName" name="fullName" autoComplete="name" required />
      </div>
      <div>
        <Label htmlFor="email">{t("email")}</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
        />
      </div>
    </AuthCard>
  );
}
