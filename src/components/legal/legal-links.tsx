import { Link } from "@tanstack/react-router";
import { Trans, useTranslation } from "react-i18next";
import type { LegalSlug } from "@/lib/legal-core";
import { legalDocument, legalDocuments } from "@/services/legal";

/** footer.json key for each document's link text. */
export const LEGAL_LINK_KEY = {
  terms: "terms",
  privacy: "privacy",
  returns: "returns",
  shipping: "shipping",
  "seller-agreement": "sellerAgreement",
} as const satisfies Record<LegalSlug, string>;

/** The documents in this build: slug + translated link text. */
export function useLegalLinks() {
  const { t } = useTranslation("footer");
  return legalDocuments().map((d) => ({ slug: d.slug, label: t(LEGAL_LINK_KEY[d.slug]) }));
}

const linkTo = (slug: LegalSlug) => (
  <Link to="/legal/$slug" params={{ slug }} target="_blank" rel="noopener" />
);

/**
 * "By continuing you agree to the Terms of Use and the Privacy Policy." Only
 * the documents that exist are named; nothing is shown when neither does.
 */
export function LegalConsent({ className }: { className?: string }) {
  const { t } = useTranslation();
  const terms = !!legalDocument("terms");
  const privacy = !!legalDocument("privacy");
  if (!terms && !privacy) return null;
  const key = terms && privacy ? "consentBoth" : terms ? "consentTerms" : "consentPrivacy";
  return (
    <p className={className ?? "legal-consent"} data-testid="legal-consent">
      <Trans
        t={t}
        i18nKey={`legal.${key}`}
        components={
          terms && privacy
            ? { 1: linkTo("terms"), 3: linkTo("privacy") }
            : { 1: linkTo(terms ? "terms" : "privacy") }
        }
      />
    </p>
  );
}
