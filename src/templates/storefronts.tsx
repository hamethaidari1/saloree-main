import { useTranslation } from "react-i18next";
import { useCategoryName } from "@/i18n/hooks";
/**
 * The five store templates. Each takes the same TemplateProps and differs in
 * structure, not just colour. Sections without data are hidden.
 */
import {
  AboutSection,
  AnnouncementBar,
  CategoryChips,
  CtaButton,
  featuredProducts,
  heroImage,
  heroSubtitle,
  heroTitle,
  ProductGrid,
  StoreMark,
  TemplateProductCard,
  TemplateRoot,
  useCategoryFilter,
} from "./blocks";
import type { TemplateProps } from "./types";

/** Classic — header, hero, featured row, grid. */
export function ClassicTemplate(p: TemplateProps) {
  const { t } = useTranslation("store");
  const { store, products, categories, settings: s } = p;
  const img = heroImage(store, s, p.mode);
  const filter = useCategoryFilter(products);
  const featured = s.show_featured ? featuredProducts(products) : [];
  return (
    <TemplateRoot code="classic" settings={s} mode={p.mode}>
      <AnnouncementBar settings={s} />
      <header className="tpl-classic-head">
        <StoreMark store={store} mode={p.mode} />
        <span className="tpl-classic-name">{store.name}</span>
      </header>
      <section className="tpl-hero" data-has-image={img ? "" : undefined}>
        {img && <img src={img} alt="" className="tpl-hero-img" />}
        <div className="tpl-hero-copy">
          <h1 className="tpl-h1">{heroTitle(store, s)}</h1>
          {heroSubtitle(s) && <p>{heroSubtitle(s)}</p>}
          <CtaButton settings={s} />
        </div>
      </section>
      {featured.length > 0 && (
        <section className="tpl-section" aria-labelledby="tpl-featured">
          <h2 id="tpl-featured" className="tpl-h2">
            {t("template.featured")}
          </h2>
          <ProductGrid products={featured} emptyName={store.name} />
        </section>
      )}
      <section id="tpl-products" className="tpl-section" aria-labelledby="tpl-all">
        <h2 id="tpl-all" className="tpl-h2">
          {t("template.allProducts")}
        </h2>
        {s.show_categories && (
          <CategoryChips
            categories={categories}
            value={filter.category}
            onChange={filter.setCategory}
          />
        )}
        <ProductGrid products={filter.shown} emptyName={store.name} />
      </section>
      <AboutSection store={store} settings={s} />
    </TemplateRoot>
  );
}

/** Boutique — full-width image hero, airy spacing, serif headings, minimal cards. */
export function BoutiqueTemplate(p: TemplateProps) {
  const { t } = useTranslation("store");
  const { store, products, categories, settings: s } = p;
  const img = heroImage(store, s, p.mode);
  const filter = useCategoryFilter(products);
  const featured = s.show_featured ? featuredProducts(products, 3) : [];
  return (
    <TemplateRoot code="boutique" settings={s} mode={p.mode}>
      <AnnouncementBar settings={s} />
      <section className="tpl-boutique-hero" data-has-image={img ? "" : undefined}>
        {img && <img src={img} alt="" className="tpl-hero-img" />}
        <div className="tpl-boutique-hero-copy">
          <StoreMark store={store} className="tpl-logo tpl-logo-lg" mode={p.mode} />
          <h1 className="tpl-h1">{heroTitle(store, s)}</h1>
          {heroSubtitle(s) && <p>{heroSubtitle(s)}</p>}
          <CtaButton settings={s} className="tpl-button tpl-button-ghost" />
        </div>
      </section>
      {featured.length > 0 && (
        <section className="tpl-section tpl-airy" aria-labelledby="tpl-featured">
          <h2 id="tpl-featured" className="tpl-h2 tpl-center">
            {t("template.selectedPieces")}
          </h2>
          <div className="tpl-boutique-featured">
            {featured.map((prod) => (
              <TemplateProductCard key={prod.id} product={prod} variant="minimal" />
            ))}
          </div>
        </section>
      )}
      <section id="tpl-products" className="tpl-section tpl-airy" aria-labelledby="tpl-all">
        <h2 id="tpl-all" className="tpl-h2 tpl-center">
          {t("template.collection")}
        </h2>
        {s.show_categories && (
          <CategoryChips
            variant="tabs"
            categories={categories}
            value={filter.category}
            onChange={filter.setCategory}
          />
        )}
        <ProductGrid products={filter.shown} variant="minimal" emptyName={store.name} />
      </section>
      <AboutSection store={store} settings={s} title={t("template.ourStory")} />
    </TemplateRoot>
  );
}

/** Market — dense: compact top strip, category shortcut tiles, deals row, compact cards. */
export function MarketTemplate(p: TemplateProps) {
  const { t } = useTranslation("store");
  const categoryName = useCategoryName();
  const { store, products, categories, settings: s } = p;
  const img = heroImage(store, s, p.mode);
  const filter = useCategoryFilter(products);
  const deals = s.show_featured ? products.filter((x) => x.originalPrice).slice(0, 8) : [];
  return (
    <TemplateRoot code="market" settings={s} mode={p.mode}>
      <AnnouncementBar settings={s} />
      <section className="tpl-market-strip">
        {img && <img src={img} alt="" className="tpl-market-strip-img" />}
        <div className="tpl-market-strip-copy">
          <StoreMark store={store} mode={p.mode} />
          <div className="min-w-0">
            <h1 className="tpl-h1">{heroTitle(store, s)}</h1>
            {heroSubtitle(s) && <p>{heroSubtitle(s)}</p>}
          </div>
          <CtaButton settings={s} />
        </div>
      </section>
      {s.show_categories && categories.length > 0 && (
        <nav className="tpl-section tpl-tight" aria-label={t("template.categoryShortcuts")}>
          <CategoryChips
            variant="tiles"
            categories={categories}
            value={filter.category}
            onChange={filter.setCategory}
          />
        </nav>
      )}
      {deals.length > 0 && (
        <section className="tpl-section tpl-tight" aria-labelledby="tpl-deals">
          <h2 id="tpl-deals" className="tpl-h2">
            {t("template.deals")}
          </h2>
          <div className="tpl-row-scroll">
            {deals.map((prod) => (
              <TemplateProductCard key={prod.id} product={prod} variant="compact" />
            ))}
          </div>
        </section>
      )}
      <section id="tpl-products" className="tpl-section tpl-tight" aria-labelledby="tpl-all">
        <h2 id="tpl-all" className="tpl-h2">
          {(() => {
            if (!filter.category) return t("template.allProductsCount", { count: products.length });
            const c = categories.find((x) => x.slug === filter.category);
            return c ? categoryName(c.slug, c.name) : t("template.productsFallback");
          })()}
        </h2>
        <ProductGrid products={filter.shown} variant="compact" emptyName={store.name} />
      </section>
      <AboutSection
        store={store}
        settings={s}
        title={t("template.aboutStore", { store: store.name })}
      />
    </TemplateRoot>
  );
}

/** Editorial (premium) — magazine cover, alternating story blocks, pull-quote about. */
export function EditorialTemplate(p: TemplateProps) {
  const { t } = useTranslation("store");
  const { store, products, categories, settings: s } = p;
  const img = heroImage(store, s, p.mode);
  const filter = useCategoryFilter(products);
  const stories = s.show_featured ? products.slice(0, 3) : [];
  return (
    <TemplateRoot code="editorial" settings={s} mode={p.mode}>
      <AnnouncementBar settings={s} />
      <section className="tpl-editorial-cover">
        <p className="tpl-kicker">{store.name}</p>
        <h1 className="tpl-h1">{heroTitle(store, s)}</h1>
        {heroSubtitle(s) && <p className="tpl-dek">{heroSubtitle(s)}</p>}
        {img && <img src={img} alt="" className="tpl-editorial-cover-img" />}
        <CtaButton settings={s} />
      </section>
      {stories.length > 0 && (
        <section className="tpl-section" aria-label={t("template.stories")}>
          {stories.map((prod, i) => (
            <article key={prod.id} className="tpl-story" data-flip={i % 2 === 1 || undefined}>
              {prod.image && <img src={prod.image} alt="" loading="lazy" />}
              <div className="tpl-story-copy">
                <p className="tpl-kicker">{t("template.storyNumber", { number: i + 1 })}</p>
                <h2 className="tpl-h2">{prod.title}</h2>
                {prod.description && <p>{prod.description.slice(0, 280)}</p>}
                <TemplateProductCard product={prod} variant="minimal" />
              </div>
            </article>
          ))}
        </section>
      )}
      <section id="tpl-products" className="tpl-section" aria-labelledby="tpl-all">
        <h2 id="tpl-all" className="tpl-h2">
          {t("template.edit")}
        </h2>
        {s.show_categories && (
          <CategoryChips
            variant="tabs"
            categories={categories}
            value={filter.category}
            onChange={filter.setCategory}
          />
        )}
        <ProductGrid products={filter.shown} emptyName={store.name} />
      </section>
      {s.show_about && store.description.trim() && (
        <blockquote className="tpl-pullquote">
          <p>{store.description}</p>
          <footer>— {store.name}</footer>
        </blockquote>
      )}
    </TemplateRoot>
  );
}

/** Bold (premium) — solid colour hero, huge type, big CTAs, heavy cards. */
export function BoldTemplate(p: TemplateProps) {
  const { t } = useTranslation("store");
  const { store, products, categories, settings: s } = p;
  const img = heroImage(store, s, p.mode);
  const filter = useCategoryFilter(products);
  const featured = s.show_featured ? featuredProducts(products, 3) : [];
  return (
    <TemplateRoot code="bold" settings={s} mode={p.mode}>
      <AnnouncementBar settings={s} />
      <section className="tpl-bold-hero">
        <div className="tpl-bold-hero-copy">
          <h1 className="tpl-h1">{heroTitle(store, s)}</h1>
          {heroSubtitle(s) && <p>{heroSubtitle(s)}</p>}
          <CtaButton settings={s} className="tpl-button tpl-button-xl" />
        </div>
        {img && <img src={img} alt="" className="tpl-bold-hero-img" />}
      </section>
      {s.show_categories && (
        <div className="tpl-section">
          <CategoryChips
            variant="blocks"
            categories={categories}
            value={filter.category}
            onChange={filter.setCategory}
          />
        </div>
      )}
      {featured.length > 0 && (
        <section className="tpl-section" aria-labelledby="tpl-featured">
          <h2 id="tpl-featured" className="tpl-h2">
            {t("template.topPicks")}
          </h2>
          <div className="tpl-bold-featured">
            {featured.map((prod) => (
              <TemplateProductCard key={prod.id} product={prod} variant="bold" />
            ))}
          </div>
        </section>
      )}
      <section id="tpl-products" className="tpl-section" aria-labelledby="tpl-all">
        <h2 id="tpl-all" className="tpl-h2">
          {t("template.shopEverything")}
        </h2>
        <ProductGrid products={filter.shown} variant="bold" emptyName={store.name} />
      </section>
      <AboutSection
        store={store}
        settings={s}
        title={t("template.thisIs", { store: store.name })}
      />
    </TemplateRoot>
  );
}
