import { useTranslation } from "react-i18next";
import { errorKey, translateError } from "@/i18n/messages";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { errorText, startGoogleSignIn, type OAuthIntent } from "@/lib/oauth";

/** Google's standard multicolor "G" (from Google's sign-in branding kit; do not recolor). */
function GoogleG() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}

/**
 * "Continue with Google". Saves where to go back to and the intent
 * (seller sign-up or not), then leaves for Google.
 */
export function GoogleButton({
  intent = "customer",
  returnTo = null,
}: {
  intent?: OAuthIntent;
  returnTo?: string | null;
}) {
  const { t } = useTranslation("auth");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="oauth-block">
      <button
        type="button"
        className="google-button"
        disabled={busy}
        aria-busy={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await startGoogleSignIn({ intent, returnTo });
            // The browser is now leaving for Google; keep the spinner.
          } catch (e) {
            const raw = errorText(e);
            // Known problems in the shopper's language, with the real message kept
            // alongside (e.g. "provider is not enabled") so it can be diagnosed.
            setError(
              errorKey(e)
                ? `${translateError(t, e)}${raw ? ` (${raw})` : ""}`
                : (raw ?? t("google.startFailed")),
            );
            setBusy(false);
          }
        }}
      >
        <span className="google-button-icon">
          {busy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <GoogleG />}
        </span>
        <span>{busy ? t("google.redirecting") : t("google.continue")}</span>
      </button>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      <div className="auth-divider" role="separator" aria-label={t("google.or")}>
        <span aria-hidden="true">{t("google.or")}</span>
      </div>
    </div>
  );
}
