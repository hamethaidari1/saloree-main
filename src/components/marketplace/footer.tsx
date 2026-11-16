import { Trans, useTranslation } from "react-i18next";
import { useCategoryName } from "@/i18n/hooks";
import { LanguageSelect } from "./header/language-select";
import { useEffect, type MouseEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouter } from "@tanstack/react-router";
import { ArrowUp } from "lucide-react";
import type { Category } from "@/data/catalog";
import { EMPTY_FOOTER, footerQuery, type FooterContent } from "@/services/site";
import { legalDocuments } from "@/services/legal";
import { useLegalLinks } from "@/components/legal/legal-links";
import { Logo } from "./logo";
import { PaymentMethods } from "./payment-methods";
import { InstagramIcon, TikTokIcon } from "./social-icons";

/** How many database categories the "Shop" column lists. */
const FOOTER_CATEGORY_COUNT = 4;

const SOCIAL_ICONS = { Instagram: InstagramIcon, TikTok: TikTokIcon } as const;

function scrollToTop() {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  // Keyboard users continue from the top of the page, not from the footer.
  document.querySelector<HTMLElement>("header a[href]")?.focus({ preventScroll: true });
}

function Column({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="footer-col">
      <h2 className="footer-heading">{heading}</h2>
      <ul className="footer-list">{children}</ul>
    </section>
  );
}

/** The built-in columns. Every <Link> is type-checked against the route tree. */
function DefaultColumns({ categories }: { categories: Pick<Category, "slug" | "name">[] }) {
  const { t } = useTranslation("footer");
  const categoryName = useCategoryName();
  return (
    <>
      <Column heading={t("shop")}>
        <li>
          <Link to="/products" className="footer-link">
            {t("allProducts")}
          </Link>
        </li>
        <li>
          <Link to="/products" search={{ sort: "newest" }} className="footer-link">
            {t("newArrivals")}
          </Link>
        </li>
        <li>
          <Link to="/stores" className="footer-link">
            {t("discoverStores")}
          </Link>
        </li>
        <li>
          <Link to="/products" search={{ sort: "popular" }} className="footer-link">
            {t("bestsellers")}
          </Link>
        </li>
        {categories.slice(0, FOOTER_CATEGORY_COUNT).map((c) => (
          <li key={c.slug}>
            <Link to="/category/$slug" params={{ slug: c.slug }} className="footer-link">
              {categoryName(c.slug, c.name)}
            </Link>
          </li>
        ))}
      </Column>
      <Column heading={t("sell")}>
        <li>
          <Link to="/register" search={{ role: "seller" }} className="footer-link">
            {t("becomeSeller")}
          </Link>
        </li>
        <li>
          <Link to="/seller" className="footer-link">
            {t("sellerDashboard")}
          </Link>
        </li>
      </Column>
      <Column heading={t("account")}>
        <li>
          <Link to="/account" className="footer-link">
            {t("yourAccount")}
          </Link>
        </li>
        <li>
          <Link to="/account" hash="my-orders" className="footer-link">
            {t("yourOrders")}
          </Link>
        </li>
        <li>
          <Link to="/cart" className="footer-link">
            {t("cart")}
          </Link>
        </li>
      </Column>
      <Column heading={t("help")}>
        <li>
          <Link to="/help" className="footer-link">
            {t("customerService")}
          </Link>
        </li>
        <LegalLinkItems />
      </Column>
    </>
  );
}

/** One link per legal page in this build (none for a page that isn't there). */
function LegalLinkItems() {
  return useLegalLinks().map((l) => (
    <li key={l.slug}>
      <Link to="/legal/$slug" params={{ slug: l.slug }} className="footer-link">
        {l.label}
      </Link>
    </li>
  ));
}

/**
 * Columns managed in the footer_links table. An internal path is only shown if
 * it matches a route of this app (so a typo or a page we don't have yet never
 * becomes a dead link); internal paths navigate in-app.
 */
function DatabaseColumns({ columns }: { columns: FooterContent["columns"] }) {
  const { t } = useTranslation("footer");
  const legalCount = legalDocuments().length;
  const router = useRouter();
  const exists = (href: string) => {
    const path = href.split(/[?#]/)[0] ?? "/";
    return router.matchRoutes(path).some((m) => m.routeId !== "__root__");
  };
  const go = (e: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    void router.navigate({ href });
  };
  const shown = columns
    .map((col) => ({
      ...col,
      links: col.links.filter((l) => !l.url.startsWith("/") || exists(l.url)),
    }))
    .filter((col) => col.links.length > 0);
  // The policies are always reachable: added unless staff already link to /legal pages.
  const hasLegal = shown.some((col) => col.links.some((l) => /^\/legal(?:[/?#]|$)/.test(l.url)));
  return (
    <>
      {shown.map((col) => (
        <Column key={col.heading} heading={col.heading}>
          {col.links.map((l) => (
            <li key={`${l.label}|${l.url}`}>
              {l.url.startsWith("/") ? (
                <a href={l.url} className="footer-link" onClick={(e) => go(e, l.url)}>
                  {l.label}
                </a>
              ) : (
                <a href={l.url} className="footer-link" rel="noopener noreferrer">
                  {l.label}
                </a>
              )}
            </li>
          ))}
        </Column>
      ))}
      {!hasLegal && legalCount > 0 && (
        <Column heading={t("help")}>
          <LegalLinkItems />
        </Column>
      )}
    </>
  );
}

/**
 * The marketplace footer (a store's own site keeps its compact StoreFooter).
 * Content comes from site_settings / footer_links; anything empty is left out.
 */
export function SiteFooter({
  categories,
  content: given,
}: {
  categories: Pick<Category, "slug" | "name">[];
  /** For tests; normally loaded from the database. */
  content?: FooterContent;
}) {
  const { t } = useTranslation("footer");
  const query = useQuery({ ...footerQuery, enabled: !given });
  useEffect(() => {
    // The footer must never take the page down: fall back to the built-in columns.
    if (query.error) console.warn("Footer settings could not be loaded:", query.error);
  }, [query.error]);
  const content = given ?? query.data ?? EMPTY_FOOTER;
  const { company } = content;
  const year = new Date().getFullYear();
  // copyright_text (set by staff) wins; then "© <year> <legal name>"; then "© <year> Saloree".
  const legalNameInCopyright = !content.copyright && Boolean(company.legalName);
  const copyright =
    content.copyright ??
    (company.legalName
      ? t("copyrightOf", { year, name: company.legalName })
      : t("copyright", { year }));
  const hasCompany = Boolean(
    (company.legalName && !legalNameInCopyright) ||
    company.businessId ||
    company.address ||
    company.supportEmail,
  );

  return (
    <footer className="site-footer">
      <button type="button" className="footer-top" onClick={scrollToTop}>
        <ArrowUp aria-hidden="true" />
        {t("backToTop")}
      </button>

      <nav className="footer-main" aria-label={t("navLabel")}>
        <div className="market-container footer-grid">
          {content.columns.length > 0 ? (
            <DatabaseColumns columns={content.columns} />
          ) : (
            <DefaultColumns categories={categories} />
          )}
        </div>
      </nav>

      <div className="market-container footer-middle">
        <PaymentMethods />
        {content.social.length > 0 && (
          <section className="footer-follow" aria-labelledby="footer-follow-heading">
            <h2 id="footer-follow-heading" className="footer-heading footer-follow-heading">
              {t("followUs")}
            </h2>
            <ul className="footer-social" aria-label={t("socialList")}>
              {content.social.map((s) => {
                const Icon = SOCIAL_ICONS[s.label];
                return (
                  <li key={s.label}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t("socialLink", { network: s.label })}
                      className="footer-social-link"
                    >
                      <Icon aria-hidden="true" />
                      <span className="sr-only"> {t("opensInNewTab")}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      <div className="footer-base">
        <div className="market-container footer-base-inner">
          <div className="footer-brand">
            <Link to="/" className="footer-logo" aria-label={t("homeLink")}>
              <Logo lazy onDark />
            </Link>
            {content.description && (
              <p className="footer-tagline" dir="auto">
                {content.description}
              </p>
            )}
          </div>

          <div className="footer-legal">
            <div className="footer-lang">
              <LanguageSelect variant="footer" />
            </div>
            <p data-testid="footer-copyright" dir="auto">
              {copyright}
            </p>
            {hasCompany && (
              <address className="footer-company" data-testid="footer-company">
                {company.legalName && !legalNameInCopyright && <span>{company.legalName}</span>}
                {company.businessId && (
                  <span>
                    <Trans
                      t={t}
                      i18nKey="businessId"
                      values={{ id: company.businessId }}
                      components={{ 1: <bdi /> }}
                    />
                  </span>
                )}
                {company.address && <span>{company.address}</span>}
                {company.supportEmail && (
                  <span>
                    <Trans
                      t={t}
                      i18nKey="support"
                      values={{ email: company.supportEmail }}
                      components={{ 1: <a href={`mailto:${company.supportEmail}`} dir="ltr" /> }}
                    />
                  </span>
                )}
              </address>
            )}
          </div>
        </div>
      </div>
    </footer>
  );
}
