import { createFileRoute } from "@tanstack/react-router";
import { headT } from "@/i18n/head";
import { ForgotPasswordView } from "@/components/marketplace/password-reset";

// Main domain only (see MAIN_ONLY_PREFIXES): the reset link must open where
// the request was made, because only that browser can use it.
export const Route = createFileRoute("/forgot-password")({
  head: ({ matches }) => ({
    meta: [
      { title: headT(matches, "auth")("forgot.metaTitle") },
      { name: "description", content: headT(matches, "auth")("forgot.metaDescription") },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ForgotPasswordView,
});
