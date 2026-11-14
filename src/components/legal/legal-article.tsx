import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFormat, useLocale } from "@/i18n/hooks";
import { PLACEHOLDER_INFO } from "@/lib/legal-core";
import { forVisitors, missingIn, tableOfContents } from "@/lib/legal-markdown";
import type { LegalDocument, LegalSettings } from "@/services/legal";
import { Blocks, type LegalViewer } from "./legal-text";

/** "Last updated 14 November 2026" in the page language (the date is a UTC day). */
export function useUpdatedLabel() {
  const { t } = useTranslation();
  const format = useFormat();
  return (updated: string) =>
    t("legal.lastUpdated", {
      date: format.date(`${updated}T00:00:00Z`, { dateStyle: "long", timeZone: "UTC" }),
    });
}

/** One legal document: title, date, contents, text. */
export function LegalArticle({
  doc,
  settings,
  viewer,
}: {
  doc: LegalDocument;
  settings: LegalSettings;
  viewer: LegalViewer;
}) {
  const { t } = useTranslation();
  const locale = useLocale();
  const updatedLabel = useUpdatedLabel();
  const { values } = settings;
  const blocks = viewer === "staff" ? doc.blocks : forVisitors(doc.blocks, values);
  const toc = tableOfContents(blocks, values);
  const missing = viewer === "staff" ? missingIn(doc.blocks, values) : [];

  return (
    <main className="market-container legal-page pb-16">
      <div className="breadcrumb legal-breadcrumb">
        <Link to="/">{t("home")}</Link>
        <ChevronRight className="rtl:-scale-x-100" />
        <Link to="/legal">{t("legal.title")}</Link>
        <ChevronRight className="rtl:-scale-x-100" />
        <span>{doc.title}</span>
      </div>

      {viewer === "staff" && (missing.length > 0 || settings.problems.length > 0) && (
        <aside
          className="legal-staff-note"
          lang="en"
          dir="ltr"
          aria-label="Missing details (staff only)"
          data-testid="legal-staff-note"
        >
          <p>
            <strong>Staff only:</strong> visitors don't see the sentences that need these details
            until they are filled in.
          </p>
          <ul>
            {missing.map((name) => (
              <li key={name}>
                {PLACEHOLDER_INFO[name].label}: set it in {PLACEHOLDER_INFO[name].setIn}.
              </li>
            ))}
            {settings.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </aside>
      )}

      <article className="legal-article" aria-labelledby="legal-title">
        <header className="legal-header">
          <h1 id="legal-title" className="page-title" lang="en" dir="ltr">
            {doc.title}
          </h1>
          <p className="page-subtitle">
            <time dateTime={doc.updated}>{updatedLabel(doc.updated)}</time>
          </p>
          {locale !== "en" && <p className="legal-language-note">{t("legal.englishOnly")}</p>}
        </header>

        {toc.length > 1 && (
          <nav className="legal-toc" aria-labelledby="legal-toc-title">
            <h2 id="legal-toc-title">{t("legal.contents")}</h2>
            {/* Headings like "1. Who we are" carry their own number: no second one. */}
            <ol
              lang="en"
              dir="ltr"
              className={
                toc.every((e) => /^\d+[.)]\s/.test(e.text)) ? "legal-toc-numbered" : undefined
              }
            >
              {toc.map((e) => (
                <li key={e.id}>
                  <a href={`#${e.id}`}>{e.text}</a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        {/* The texts are English for now, so they read left to right in every language. */}
        <div className="legal-body" lang="en" dir="ltr" data-testid="legal-body">
          <Blocks blocks={blocks} values={values} viewer={viewer} />
        </div>
      </article>
    </main>
  );
}
