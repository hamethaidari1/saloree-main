import { headT } from "@/i18n/head";
import { createFileRoute } from "@tanstack/react-router";
import { OAuthCallbackView } from "@/components/marketplace/oauth-callback";

// Google → Supabase → here with ?code= (PKCE). Browser only: the code
// verifier and the session live in this browser's storage.
export const Route = createFileRoute("/auth/callback")({
  ssr: false,
  head: ({ matches }) => ({
    meta: [
      { title: headT(matches, "auth")("callback.metaTitle") },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CallbackPage,
});

function CallbackPage() {
  return <OAuthCallbackView href={window.location.href} />;
}
