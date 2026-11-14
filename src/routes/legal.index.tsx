import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUpdatedLabel } from "@/components/legal/legal-article";
import { useLegalLinks } from "@/components/legal/legal-links";
import { headT } from "@/i18n/head";
import { useLocale } from "@/i18n/hooks";
import { canonicalUrl } from "@/lib/host";
import { legalDocuments } from "@/services/legal";

export const Route = createFileRoute("/legal/")({
  head: ({ matches }) => {
    const t = headT(matches);
    const canonical = canonicalUrl("/legal");
    return {
      meta: [
        { title: t("legal.metaTitle") },
        { name: "description", content: t("legal.metaDescription") },
      ],
      links: canonical ? [{ rel: "canonical", href: canonical }] : [],
    };
  },
  component: LegalIndexPage,
});

/** Every policy in this build, with its date. Exported for tests. */
export function LegalIndexPage() {
  const { t } = useTranslation();
  const links = useLegalLinks();
  const updatedLabel = useUpdatedLabel();
  const docs = legalDocuments();
  const locale = useLocale();
  return (
    <main className="market-container legal-page pb-16">
      <div className="breadcrumb">
        <Link to="/">{t("home")}</Link>
        <ChevronRight className="rtl:-scale-x-100" />
        <span>{t("legal.title")}</span>
      </div>
      <h1 className="page-title">{t("legal.title")}</h1>
      <p className="page-subtitle">{t("legal.subtitle")}</p>
      {docs.length ? (
        <ul className="legal-index">
          {links.map((l) => (
            <li key={l.slug}>
              <Link to="/legal/$slug" params={{ slug: l.slug }}>
                {l.label}
              </Link>
              <span>{updatedLabel(docs.find((d) => d.slug === l.slug)!.updated)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="legal-index-empty">{t("legal.none")}</p>
      )}
      {docs.length > 0 && locale !== "en" && (
        <p className="legal-language-note">{t("legal.englishOnlyAll")}</p>
      )}
    </main>
  );
}
