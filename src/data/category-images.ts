// Home page "Find your kind of thing" images, keyed by database category slug.
// The WebP files are 4:3 crops made from the originals in src/assets/Findyourkindofthing/
// (the originals are not imported, so they stay out of the bundle).
import automotive400 from "@/assets/categories/automotive-400.webp";
import automotive800 from "@/assets/categories/automotive-800.webp";
import beautyHealth400 from "@/assets/categories/beauty-health-400.webp";
import beautyHealth800 from "@/assets/categories/beauty-health-800.webp";
import booksStationery400 from "@/assets/categories/books-stationery-400.webp";
import booksStationery800 from "@/assets/categories/books-stationery-800.webp";
import electronics400 from "@/assets/categories/electronics-400.webp";
import electronics800 from "@/assets/categories/electronics-800.webp";
import fashion400 from "@/assets/categories/fashion-400.webp";
import fashion800 from "@/assets/categories/fashion-800.webp";
import homeKitchen400 from "@/assets/categories/home-kitchen-400.webp";
import homeKitchen800 from "@/assets/categories/home-kitchen-800.webp";
import sportsOutdoors400 from "@/assets/categories/sports-outdoors-400.webp";
import sportsOutdoors800 from "@/assets/categories/sports-outdoors-800.webp";
import toysGames400 from "@/assets/categories/toys-games-400.webp";
import toysGames800 from "@/assets/categories/toys-games-800.webp";

export interface CategoryImage {
  /** 400px wide, for small cards. */
  small: string;
  /** 800px wide, the default `src`. */
  large: string;
}

/** Intrinsic size of the large file (4:3); used to reserve space before load. */
export const CATEGORY_IMAGE_SIZE = { width: 800, height: 600 } as const;

/**
 * Must match .category-grid in styles.css: 2 columns below 640px, 3 below 1024px,
 * then 4 inside the 1280px .market-container.
 */
export const CATEGORY_IMAGE_SIZES =
  "(max-width: 639px) 50vw, (max-width: 1023px) 33vw, min(25vw, 320px)";

export const CATEGORY_IMAGE_ENTRIES: ReadonlyArray<readonly [slug: string, image: CategoryImage]> =
  [
    ["automotive", { small: automotive400, large: automotive800 }],
    ["beauty-health", { small: beautyHealth400, large: beautyHealth800 }],
    ["books-stationery", { small: booksStationery400, large: booksStationery800 }],
    ["electronics", { small: electronics400, large: electronics800 }],
    ["fashion", { small: fashion400, large: fashion800 }],
    ["home-kitchen", { small: homeKitchen400, large: homeKitchen800 }],
    ["sports-outdoors", { small: sportsOutdoors400, large: sportsOutdoors800 }],
    ["toys-games", { small: toysGames400, large: toysGames800 }],
  ];

const BY_SLUG = new Map(CATEGORY_IMAGE_ENTRIES);

/** The bundled image for a category, or undefined (the card then shows a neutral tile). */
export function categoryImage(slug: string): CategoryImage | undefined {
  return BY_SLUG.get(slug);
}
