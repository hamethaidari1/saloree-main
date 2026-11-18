import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { Product } from "@/data/catalog";
import { useFormat } from "@/i18n/hooks";
import { MORE_PAGE, moreShown } from "@/lib/home-sections";
import { ProductCard, SectionHeading } from "./shared";

function ViewAllInner() {
  const { t } = useTranslation("common");
  return (
    <>
      {t("viewAll")}
      <ArrowRight size={13} className="rtl:-scale-x-100" aria-hidden />
    </>
  );
}

/**
 * One shelf: a title, a "View all" link and up to 12 products in the dense
 * home grid. Hidden when it has no products. `eager` = the first shelf on the
 * page, whose first row of photos loads right away.
 */
export function Shelf({
  id,
  title,
  subtitle,
  products,
  link,
  eager = false,
}: {
  id: string;
  title: string;
  subtitle?: string | undefined;
  products: Product[];
  /** Renders the "View all" <Link> (each shelf has its own destination). */
  link: (children: ReactNode, ariaLabel: string) => ReactNode;
  eager?: boolean;
}) {
  const { t } = useTranslation("home");
  if (!products.length) return null;
  const headingId = `shelf-${id}`;
  return (
    <section
      className="market-section home-shelf"
      aria-labelledby={headingId}
      data-testid={headingId}
    >
      <SectionHeading id={headingId} title={title} {...(subtitle ? { subtitle } : {})}>
        {link(<ViewAllInner />, t("shelves.viewAllAria", { title }))}
      </SectionHeading>
      <div className="product-grid home-grid">
        {products.map((p, i) => (
          // The first row (at most 5 cards wide) is in the first screen.
          <ProductCard key={p.id} product={p} eager={eager && i < 5} />
        ))}
      </div>
      <span className="sr-only">{t("shelves.count", { shown: products.length })}</span>
    </section>
  );
}

/** "More products for you": 24 at first, 24 more per "Load more". */
export function MoreForYou({ products }: { products: Product[] }) {
  const { t } = useTranslation("home");
  const format = useFormat();
  const [clicks, setClicks] = useState(0);
  if (!products.length) return null;
  const shown = moreShown(clicks, products.length);
  const left = products.length - shown;
  return (
    <section
      className="market-section home-shelf home-shelf-more"
      aria-labelledby="shelf-more"
      data-testid="shelf-more"
    >
      <SectionHeading
        id="shelf-more"
        title={t("shelves.moreTitle")}
        subtitle={t("shelves.moreSubtitle")}
      >
        <Link
          to="/products"
          aria-label={t("shelves.viewAllAria", { title: t("shelves.moreTitle") })}
        >
          <ViewAllInner />
        </Link>
      </SectionHeading>
      <div className="product-grid home-grid">
        {products.slice(0, shown).map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
      <div className="home-more">
        <p className="home-more-status" role="status">
          {t("shelves.showing", {
            shown: format.number(shown),
            total: format.number(products.length),
          })}
        </p>
        {left > 0 ? (
          <Button variant="outline" onClick={() => setClicks((c) => c + 1)}>
            {t("shelves.loadMore", { n: format.number(Math.min(MORE_PAGE, left)) })}
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link to="/products">
              {t("shelves.browseAll")}
              <ArrowRight className="rtl:-scale-x-100" aria-hidden />
            </Link>
          </Button>
        )}
      </div>
    </section>
  );
}

/** No products in the marketplace yet. */
export function HomeEmpty() {
  const { t } = useTranslation("home");
  return (
    <section className="market-section">
      <div className="empty-state home-empty" data-testid="home-empty">
        <h2>{t("shelves.emptyTitle")}</h2>
        <p>{t("shelves.emptyText")}</p>
        <Button asChild variant="outline">
          <Link to="/stores">{t("shelves.emptyCta")}</Link>
        </Button>
      </div>
    </section>
  );
}
