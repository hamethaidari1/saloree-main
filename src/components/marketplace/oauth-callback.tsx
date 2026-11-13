import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { errorKey, translateError } from "@/i18n/messages";
import { useEffect, useRef, useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { completeOAuthSignIn, errorText, OAuthCallbackError } from "@/lib/oauth";

type State = { status: "working" } | { status: "error"; error: OAuthCallbackError };

/**
 * Known problems in the shopper's language; anything else as Supabase/Google
 * reported it. For known ones the original message stays visible as a detail.
 */
function callbackMessage(t: TFunction, error: OAuthCallbackError) {
  if (error.code === "no_session") return { text: t("callback.noSession"), detail: null };
  return errorKey(error)
    ? { text: translateError(t, error), detail: error.message }
    : { text: error.message, detail: null };
}

/** Finishes Google sign-in, then replaces this page with the destination. */
export function OAuthCallbackView({ href }: { href: string }) {
  const { t } = useTranslation("auth");
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "working" });
  // The code can be exchanged only once (React may run effects twice in development).
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    completeOAuthSignIn(href)
      .then((destination) => router.history.replace(destination))
      .catch((e: unknown) =>
        setState({
          status: "error",
          error:
            e instanceof OAuthCallbackError
              ? e
              : new OAuthCallbackError(errorText(e) ?? t("callback.generic"), "signin"),
        }),
      );
  }, [href, router, t]);

  if (state.status === "working")
    return (
      <main className="market-container auth-page">
        <div className="auth-card" aria-busy="true">
          <p className="oauth-status" role="status">
            <Loader2 className="animate-spin" aria-hidden="true" />
            {t("callback.signingIn")}
          </p>
        </div>
      </main>
    );

  const { error } = state;
  const seller = error.stage === "seller";
  const message = callbackMessage(t, error);
  return (
    <main className="market-container auth-page">
      <div className="auth-card">
        <h1 className="page-title">
          {seller ? t("callback.sellerTitle") : t("callback.failTitle")}
        </h1>
        <p className="page-subtitle">
          {seller ? t("callback.sellerIntro") : t("callback.failIntro")}
        </p>
        <div role="alert" className="auth-error" data-testid="oauth-error">
          <p>{message.text}</p>
          {(message.detail || (error.code && error.code !== "no_session")) && (
            <p className="oauth-error-code" dir="ltr">
              <bdi>
                {message.detail}
                {error.code && error.code !== "no_session" && ` (${error.code})`}
              </bdi>
            </p>
          )}
        </div>
        <div className="auth-footer">
          {seller ? (
            <Link to="/account">{t("callback.toAccount")}</Link>
          ) : (
            <Link to="/login">{t("callback.back")}</Link>
          )}
        </div>
      </div>
    </main>
  );
}
