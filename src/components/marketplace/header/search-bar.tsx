import { useTranslation } from "react-i18next";
import { useCategoryName } from "@/i18n/hooks";
import { useEffect, useId, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { catalogQuery } from "@/services/catalog";

/**
 * Category scope + text search; submits to /products?q=…&category=…
 * `compact` (small screens) drops the category box and searches everything;
 * the category filter is then chosen on the results page.
 */
export function SearchBar({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation("nav");
  const categoryName = useCategoryName();
  const id = useId();
  const navigate = useNavigate();
  const catalog = useQuery(catalogQuery);
  const current = useRouterState({
    select: (s) => s.location.search as { q?: unknown; category?: unknown },
  });
  const urlQuery = typeof current.q === "string" ? current.q : "";
  const urlCategory = typeof current.category === "string" ? current.category : "";
  const [query, setQuery] = useState(urlQuery);
  const [category, setCategory] = useState(urlCategory);
  // Keep the box in step with the URL (back/forward, links elsewhere).
  useEffect(() => setQuery(urlQuery), [urlQuery]);
  useEffect(() => setCategory(urlCategory), [urlCategory]);

  const categories = catalog.data?.categories ?? [];
  return (
    <form
      role="search"
      aria-label={t("search.label")}
      className="nav-search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = query.trim();
        const scope = compact ? "" : category;
        void navigate({
          to: "/products",
          search: { ...(q ? { q } : {}), ...(scope ? { category: scope } : {}) },
        });
      }}
    >
      {!compact && (
        <>
          <label htmlFor={`${id}-category`} className="sr-only">
            {t("search.category")}
          </label>
          <select
            id={`${id}-category`}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={catalog.isPending}
            aria-busy={catalog.isPending}
          >
            <option value="">{t("search.all")}</option>
            {catalog.isPending && <option disabled>{t("search.loadingCategories")}</option>}
            {catalog.isError && <option disabled>{t("search.unavailable")}</option>}
            {catalog.isSuccess && !categories.length && (
              <option disabled>{t("search.none")}</option>
            )}
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {categoryName(c.slug, c.name)}
              </option>
            ))}
          </select>
        </>
      )}
      <label htmlFor={`${id}-q`} className="sr-only">
        {t("search.input")}
      </label>
      <input
        id={`${id}-q`}
        type="search"
        enterKeyHint="search"
        placeholder={t("search.placeholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <button type="submit" aria-label={t("search.submit")}>
        <Search size={20} aria-hidden />
      </button>
    </form>
  );
}
