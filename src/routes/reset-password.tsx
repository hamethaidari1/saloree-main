import { createFileRoute } from "@tanstack/react-router";
import { headT } from "@/i18n/head";
import { ResetPasswordView } from "@/components/marketplace/password-reset";

// Opened from the reset email. Browser only: the recovery session (and the
// PKCE verifier it needs) lives in this browser's storage. Main domain only.
export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: ({ matches }) => ({
    meta: [
      { title: headT(matches, "auth")("reset.metaTitle") },
      { name: "robots", content: "noindex, nofollow" },
      // The link's one-time code must never travel to another site.
      { name: "referrer", content: "no-referrer" },
    ],
  }),
  component: ResetPasswordView,
});
