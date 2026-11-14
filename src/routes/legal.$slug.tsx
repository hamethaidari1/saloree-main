import { createFileRoute, notFound } from "@tanstack/react-router";
import { LegalArticle } from "@/components/legal/legal-article";
import type { LegalViewer } from "@/components/legal/legal-text";
import { headT } from "@/i18n/head";
import { useAuth } from "@/lib/auth";
import { canonicalUrl } from "@/lib/host";
import { describe, forVisitors } from "@/lib/legal-markdown";
import { isStaff } from "@/lib/staff-access";
import { legalDocument, legalSettingsQuery, type LegalSettings } from "@/services/legal";

export const Route = createFileRoute("/legal/$slug")({
  loader: async ({ params, context }): Promise<{ settings: LegalSettings }> => {
    if (!legalDocument(params.slug)) throw notFound();
    // Loaded on the server, so the page is complete in its HTML. Never fails the page.
    const settings = await context.queryClient
      .ensureQueryData(legalSettingsQuery)
      .catch((e: unknown): LegalSettings => ({
        values: {},
        problems: [e instanceof Error ? e.message : String(e)],
      }));
    return { settings };
  },
  head: ({ params, loaderData, matches }) => {
    const doc = legalDocument(params.slug);
    if (!doc) return { meta: [{ title: headT(matches)("meta.defaultTitle") }] };
    const values = loaderData?.settings.values ?? {};
    const title = `${doc.title} — Saloree`;
    // From what visitors see: never a sentence with a missing value.
    const description = describe(forVisitors(doc.blocks, values), values);
    const canonical = canonicalUrl(`/legal/${doc.slug}`);
    return {
      meta: [
        { title },
        ...(description ? [{ name: "description", content: description }] : []),
        { property: "og:title", content: title },
        ...(description ? [{ property: "og:description", content: description }] : []),
      ],
      links: canonical ? [{ rel: "canonical", href: canonical }] : [],
    };
  },
  component: LegalPage,
});

function LegalPage() {
  const { slug } = Route.useParams();
  const { settings } = Route.useLoaderData();
  const doc = legalDocument(slug)!;
  const { roles, ready } = useAuth();
  // The server and the first browser render are the visitor view (no hydration mismatch).
  const viewer: LegalViewer = ready && isStaff(roles) ? "staff" : "visitor";
  return <LegalArticle doc={doc} settings={settings} viewer={viewer} />;
}
