import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { SlidersHorizontal, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSuspenseQuery } from "@tanstack/react-query";
import { catalogQuery, filterProducts } from "@/services/catalog";
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
  const [category, setCategory] = useState(initialCategory);
  const [store, setStore] = useState("");
  const [maxPrice, setMaxPrice] = useState(200);
  const [rating, setRating] = useState(0);
  const [sort, setSort] = useState(initialSort);
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);
  const { data: catalog } = useSuspenseQuery(catalogQuery);
  const { categories, stores } = catalog;
  const hasRatings = catalog.products.some((p) => p.rating > 0);
  const filtered = filterProducts(
    { query, category, store, maxPrice, rating, sort },
    catalog,
  ).filter((p) => !sale || p.originalPrice);
  const pages = Math.ceil(filtered.length / 9);
  const title = query
    ? `Results for “${query}”`
    : (categories.find((c) => c.slug === initialCategory)?.name ??
      (sale ? "Lovely finds, little prices" : "Discover all finds"));
  const resetPage = (fn: () => void) => {
    fn();
    setPage(1);
  };
  return (
    <main className="market-container">
      <div className="breadcrumb">
        <Link to="/">Home</Link>
        <ChevronRight />
        <span>{initialCategory ? "Categories" : "All products"}</span>
      </div>
      <h1 className="page-title">{title}</h1>
      <p className="page-subtitle">Thoughtful products. Independent stores. Something for you.</p>
      <div className="browse-layout">
        <aside
          className={`filter-sidebar ${showFilters ? "open" : ""}`}
          aria-label="Product filters"
        >
          <div className="flex justify-between mb-6">
            <h2 className="font-semibold">Filters</h2>
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
              Reset
            </Button>
          </div>
          <div className="filter-group">
            <h3>Categories</h3>
            <label className="filter-option">
              <input
                type="radio"
                name="category"
                checked={!category}
                onChange={() => resetPage(() => setCategory(""))}
              />
              All categories
            </label>
            {categories.map((c) => (
              <label key={c.slug} className="filter-option">
                <input
                  type="radio"
                  name="category"
                  checked={category === c.slug}
                  onChange={() => resetPage(() => setCategory(c.slug))}
                />
                {c.name}
              </label>
            ))}
          </div>
          <div className="filter-group">
            <h3>Price range</h3>
            <input
              type="range"
              aria-label="Maximum price"
              min="0"
              max="200"
              step="5"
              value={maxPrice}
              onChange={(e) => resetPage(() => setMaxPrice(Number(e.target.value)))}
            />
            <div className="flex justify-between text-xs mt-3 text-muted-foreground">
              <span>$0</span>
              <span>Up to ${maxPrice}</span>
            </div>
          </div>
          <div className="filter-group" hidden={!hasRatings}>
            <h3>Customer rating</h3>
            {[0, 4.8, 4.9].map((r) => (
              <label key={r} className="filter-option">
                <input
                  type="radio"
                  name="rating"
                  checked={rating === r}
                  onChange={() => resetPage(() => setRating(r))}
                />
                {r ? `${r} stars & up` : "All ratings"}
              </label>
            ))}
          </div>
          <div className="filter-group">
            <h3>Store</h3>
            <select
              aria-label="Filter by store"
              value={store}
              onChange={(e) => resetPage(() => setStore(e.target.value))}
            >
              <option value="">All independent stores</option>
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
            <span>{filtered.length} finds</span>
            <Button
              variant="outline"
              size="sm"
              className="mobile-filter-toggle"
              onClick={() => setShowFilters(!showFilters)}
            >
              <SlidersHorizontal />
              Filters
            </Button>
            <select
              aria-label="Sort products"
              className="sort-select"
              value={sort}
              onChange={(e) => resetPage(() => setSort(e.target.value))}
            >
              <option value="newest">Newest arrivals</option>
              <option value="price-low">Price: low to high</option>
              <option value="price-high">Price: high to low</option>
              <option value="popular">Most popular</option>
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
                    aria-label={`Page ${i + 1}`}
                    aria-current={page === i + 1 ? "page" : undefined}
                    onClick={() => {
                      setPage(i + 1);
                      window.scrollTo({ top: 150, behavior: "smooth" });
                    }}
                  >
                    {i + 1}
                  </Button>
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              title="No finds just yet"
              description="Try a different search or adjust your filters."
            />
          )}
        </div>
      </div>
    </main>
  );
}
