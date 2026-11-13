import { useCategoryName } from "@/i18n/hooks";
import { Link } from "@tanstack/react-router";
import { Shapes } from "lucide-react";
import type { Category } from "@/data/catalog";
import { CATEGORY_IMAGE_SIZE, CATEGORY_IMAGE_SIZES, categoryImage } from "@/data/category-images";

/**
 * "Find your kind of thing": one card per database category, in the order given.
 * Categories without a bundled image get a neutral tile of the same size.
 */
export function CategoryGrid({ categories }: { categories: Pick<Category, "slug" | "name">[] }) {
  const categoryName = useCategoryName();
  return (
    <ul className="category-grid">
      {categories.map((c) => {
        const image = categoryImage(c.slug);
        const name = categoryName(c.slug, c.name);
        return (
          <li key={c.slug}>
            <Link
              to="/category/$slug"
              params={{ slug: c.slug }}
              className="category-card"
              data-has-image={image ? "true" : "false"}
            >
              <span className="category-card-media">
                {image ? (
                  <img
                    src={image.large}
                    srcSet={`${image.small} 400w, ${image.large} 800w`}
                    sizes={CATEGORY_IMAGE_SIZES}
                    width={CATEGORY_IMAGE_SIZE.width}
                    height={CATEGORY_IMAGE_SIZE.height}
                    alt={name}
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <span className="category-card-fallback" role="img" aria-label={name}>
                    <Shapes aria-hidden="true" />
                  </span>
                )}
              </span>
              {/* The image's alt text already names the link. */}
              <span className="category-card-name" aria-hidden="true">
                {name}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
