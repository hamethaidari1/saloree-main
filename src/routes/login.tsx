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
import { safeRedirect, signIn } from "@/lib/auth";
import { homeForRoles, safeReturnTo } from "@/lib/redirects";

type LoginSearch = { redirect?: string; notice?: "password-updated" };

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>): LoginSearch => ({
    ...(typeof s["redirect"] === "string" ? { redirect: s["redirect"] } : {}),
    ...(s["notice"] === "password-updated" ? { notice: "password-updated" as const } : {}),
  }),
  head: ({ matches }) => ({
    meta: [
      { title: headT(matches, "auth")("login.metaTitle") },
      { name: "description", content: headT(matches, "auth")("login.metaDescription") },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation("auth");
  const { redirect, notice } = Route.useSearch();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthCard
      title={t("login.title")}
      subtitle={t("login.subtitle")}
      submitLabel={t("login.submit")}
      busy={busy}
      error={error}
      notice={notice === "password-updated" ? t("login.passwordUpdated") : null}
      onSubmit={async (form) => {
        setBusy(true);
        setError(null);
        try {
          const { roles } = await signIn(String(form.get("email")), String(form.get("password")));
          router.history.push(safeRedirect(redirect, homeForRoles(roles)));
        } catch (e) {
          setError(errorKey(e) || errorText(e) ? translateError(t, e) : t("login.failed"));
          setBusy(false);
        }
      }}
      oauth={<GoogleButton returnTo={safeReturnTo(redirect)} />}
      footer={
        <>
          <Trans t={t} i18nKey="login.newTo" components={{ 1: <Link to="/register" /> }} />
        </>
      }
    >
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
          autoComplete="current-password"
          required
        />
        <Link to="/forgot-password" className="auth-forgot">
          {t("login.forgot")}
        </Link>
      </div>
    </AuthCard>
  );
}
