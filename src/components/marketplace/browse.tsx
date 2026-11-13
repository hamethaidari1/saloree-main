import { useTranslation } from "react-i18next";
import { useCategoryName, useFormat } from "@/i18n/hooks";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { SlidersHorizontal, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSuspenseQuery } from "@tanstack/react-query";
import { catalogQuery, filterProducts } from "@/services/catalog";
import { useStoreSlug } from "@/lib/store-mode";
import { ProductCard, EmptyState } from "./shared";
export function Browse({
  category: initialCategory = "",
  query = "",
  initialSort = "newest",
  sale = false,
}: {
  category?: string;
  query?: string;
  initialSort?: string;
  sale?: boolean;
}) {
  const { t } = useTranslation("product");
  const format = useFormat();
  const categoryName = useCategoryName();
  const [category, setCategory] = useState(initialCategory);
  const [store, setStore] = useState("");
  const [maxPrice, setMaxPrice] = useState(200);
  const [rating, setRating] = useState(0);
  const [sort, setSort] = useState(initialSort);
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const { data: catalog } = useSuspenseQuery(catalogQuery);
  // On a store's own site, everything is limited to that store.
  const storeSlug = useStoreSlug();
  const { stores } = catalog;
  const categories = storeSlug
    ? catalog.categories.filter((c) =>
        catalog.products.some((p) => p.storeSlug === storeSlug && p.category === c.slug),
      )
    : catalog.categories;
  const hasRatings = catalog.products.some((p) => p.rating > 0);
  const filtered = filterProducts(
    { query, category, store: storeSlug ?? store, maxPrice, rating, sort },
    catalog,
  ).filter((p) => !sale || p.originalPrice);
  const pages = Math.ceil(filtered.length / 9);
  const current = categories.find((c) => c.slug === initialCategory);
  const title = query
    ? t("browse.resultsFor", { query })
    : current
      ? categoryName(current.slug, current.name)
      : sale
        ? t("browse.saleTitle")
        : t("browse.allTitle");
  const wholeDollars = (n: number) =>
    format.number(n, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  const resetPage = (fn: () => void) => {
    fn();
    setPage(1);
  };
  return (
    <main className="market-container">
      <div className="breadcrumb">
        <Link to="/">{t("home", { ns: "common" })}</Link>
        <ChevronRight className="rtl:-scale-x-100" />
        <span>{initialCategory ? t("browse.categoriesCrumb") : t("allProducts")}</span>
      </div>
      <h1 className="page-title">{title}</h1>
      <p className="page-subtitle">{t("browse.subtitle")}</p>
      <div className="browse-layout">
        <aside
          className={`filter-sidebar ${showFilters ? "open" : ""}`}
          aria-label={t("browse.filtersAria")}
        >
          <div className="flex justify-between mb-6">
            <h2 className="font-semibold">{t("browse.filters")}</h2>
            <Button
              variant="link"
              size="sm"
              className="p-0 h-auto text-xs"
              onClick={() => {
                setCategory(initialCategory);
                setStore("");
                setMaxPrice(200);
                setRating(0);
                setPage(1);
              }}
            >
              {t("browse.reset")}
            </Button>
          </div>
          <div className="filter-group">
            <h3>{t("browse.categories")}</h3>
            <label className="filter-option">
              <input
                type="radio"
                name="category"
                checked={!category}
                onChange={() => resetPage(() => setCategory(""))}
              />
              {t("browse.allCategories")}
            </label>
            {categories.map((c) => (
              <label key={c.slug} className="filter-option">
                <input
                  type="radio"
                  name="category"
                  checked={category === c.slug}
                  onChange={() => resetPage(() => setCategory(c.slug))}
                />
                {categoryName(c.slug, c.name)}
              </label>
            ))}
          </div>
          <div className="filter-group">
            <h3>{t("browse.priceRange")}</h3>
            <input
              type="range"
              aria-label={t("browse.maxPrice")}
              min="0"
              max="200"
              step="5"
              value={maxPrice}
              onChange={(e) => resetPage(() => setMaxPrice(Number(e.target.value)))}
            />
            <div className="flex justify-between text-xs mt-3 text-muted-foreground">
              <span>{wholeDollars(0)}</span>
              <span>{t("browse.upTo", { price: wholeDollars(maxPrice) })}</span>
            </div>
          </div>
          <div className="filter-group" hidden={!hasRatings}>
            <h3>{t("browse.rating")}</h3>
            {[0, 4.8, 4.9].map((r) => (
              <label key={r} className="filter-option">
                <input
                  type="radio"
                  name="rating"
                  checked={rating === r}
                  onChange={() => resetPage(() => setRating(r))}
                />
                {r ? t("browse.starsUp", { rating: format.number(r) }) : t("browse.allRatings")}
              </label>
            ))}
          </div>
          <div className="filter-group" hidden={!!storeSlug}>
            <h3>{t("browse.store")}</h3>
            <select
              aria-label={t("browse.filterByStore")}
              value={store}
              onChange={(e) => resetPage(() => setStore(e.target.value))}
            >
              <option value="">{t("browse.allStores")}</option>
              {stores.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        </aside>
        <div className="min-w-0">
          <div className="browse-toolbar">
            <span>{t("browse.finds", { count: filtered.length })}</span>
            <Button
              variant="outline"
              size="sm"
              className="mobile-filter-toggle"
              onClick={() => setShowFilters(!showFilters)}
            >
              <SlidersHorizontal />
              {t("browse.filters")}
            </Button>
            <select
              aria-label={t("browse.sortAria")}
              className="sort-select"
              value={sort}
              onChange={(e) => resetPage(() => setSort(e.target.value))}
            >
              <option value="newest">{t("browse.sortNewest")}</option>
              <option value="price-low">{t("browse.sortPriceLow")}</option>
              <option value="price-high">{t("browse.sortPriceHigh")}</option>
              <option value="popular">{t("browse.sortPopular")}</option>
            </select>
          </div>
          {filtered.length ? (
            <>
              <div className="product-grid">
                {filtered.slice((page - 1) * 9, page * 9).map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
              <div className="pagination">
                {Array.from({ length: pages }, (_, i) => (
                  <Button
                    key={i}
                    variant={page === i + 1 ? "default" : "outline"}
                    size="icon"
                    aria-label={t("page", { ns: "common", page: i + 1 })}
                    aria-current={page === i + 1 ? "page" : undefined}
                    onClick={() => {
                      setPage(i + 1);
                      window.scrollTo({ top: 150, behavior: "smooth" });
                    }}
                  >
                    {format.number(i + 1)}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <EmptyState title={t("browse.emptyTitle")} description={t("browse.emptyText")} />
          )}
        </div>
      </div>
    </main>
  );
}
