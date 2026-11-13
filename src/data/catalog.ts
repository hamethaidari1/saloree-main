import p1 from "@/assets/product-1.jpg";
import p2 from "@/assets/product-2.jpg";
import p3 from "@/assets/product-3.jpg";
import p4 from "@/assets/product-4.jpg";
import p5 from "@/assets/product-5.jpg";
import p6 from "@/assets/product-6.jpg";
import p7 from "@/assets/product-7.jpg";
import p8 from "@/assets/product-8.jpg";
import p9 from "@/assets/product-9.jpg";
import p10 from "@/assets/product-10.jpg";
import p11 from "@/assets/product-11.jpg";
import p12 from "@/assets/product-12.jpg";
import p13 from "@/assets/product-13.jpg";
import p14 from "@/assets/product-14.jpg";
import p15 from "@/assets/product-15.jpg";
import p16 from "@/assets/product-16.jpg";
import p17 from "@/assets/product-17.jpg";
import p18 from "@/assets/product-18.jpg";
import p19 from "@/assets/product-19.jpg";
import p20 from "@/assets/product-20.jpg";
import p21 from "@/assets/product-21.jpg";
import p22 from "@/assets/product-22.jpg";
import p23 from "@/assets/product-23.jpg";
import p24 from "@/assets/product-24.jpg";
// UI-facing catalog types. Live data comes from src/services/catalog.ts; the
// records below are fixtures for tests only — pages must not import them.
export interface Category {
  slug: string;
  name: string;
  image: string;
}
export interface Catalog {
  products: Product[];
  stores: Store[];
  categories: Category[];
}
export interface Product {
  /** Unix ms; used for "newest" sorting. */
  createdAt?: number;
  id: string;
  title: string;
  price: number;
  originalPrice?: number;
  /** 0 means "no ratings yet" — the database has no reviews table. */
  rating: number;
  reviews: number;
  storeSlug: string;
  category: string;
  /** The main photo (cards, cart). */
  image: string;
  /**
   * Every photo for the product page: the main one first, then the rest in
   * sort_order, each once. Absent on hand-made test fixtures (use `image`).
   */
  images?: string[];
  stock: number;
  description: string;
  badge?: string;
}
export interface Store {
  /** Database id (absent on test fixtures). */
  id?: string;
  slug: string;
  name: string;
  initials: string;
  description: string;
  rating: number;
  specialty: string;
  image: string;
  tone: string;
  /** Store's own logo / banner (null when not uploaded; absent on fixtures). */
  logo?: string | null;
  banner?: string | null;
}
export const categories: Category[] = [
  { slug: "home-living", name: "Home & Living", image: p8 },
  { slug: "fashion", name: "Fashion", image: p10 },
  { slug: "electronics", name: "Electronics", image: p3 },
  { slug: "beauty-care", name: "Beauty & Care", image: p4 },
  { slug: "accessories", name: "Accessories", image: p9 },
  { slug: "lifestyle", name: "Lifestyle", image: p15 },
];
export const stores: Store[] = [
  {
    slug: "terra-home",
    name: "Terra Home",
    initials: "th.",
    description:
      "Thoughtful pieces for the spaces you call home. Natural textures, timeless shapes, and everyday comfort.",
    rating: 4.9,
    specialty: "A little more at home",
    image: p8,
    tone: "sage",
  },
  {
    slug: "thread-and-form",
    name: "Thread & Form",
    initials: "t&f",
    description: "Easy essentials, beautifully made. A considered wardrobe for your everyday.",
    rating: 4.8,
    specialty: "Everyday, elevated",
    image: p10,
    tone: "rose",
  },
  {
    slug: "studio-tech",
    name: "Studio Tech",
    initials: "st",
    description:
      "Smart design meets everyday performance. Discover technology that fits your life.",
    rating: 4.9,
    specialty: "Made for modern living",
    image: p3,
    tone: "blue",
  },
  {
    slug: "bloom-essentials",
    name: "Bloom Essentials",
    initials: "be",
    description: "Small rituals, big moments of care. Gentle essentials for your daily routine.",
    rating: 4.7,
    specialty: "Feel good, naturally",
    image: p4,
    tone: "peach",
  },
  {
    slug: "good-company",
    name: "Good Company",
    initials: "gc.",
    description: "Useful, joyful objects for wherever the day takes you. Made to be kept close.",
    rating: 4.8,
    specialty: "Good things, every day",
    image: p15,
    tone: "sage",
  },
];
const seeds: [string, number, string, string, string, number?][] = [
  ["Everyday Ceramic Mug", 24, "terra-home", "home-living", p1, 32],
  ["The Everyday Canvas Tote", 39, "thread-and-form", "accessories", p2],
  ["Studio Wireless Headphones", 89, "studio-tech", "electronics", p3, 119],
  ["Botanical Glow Serum", 28, "bloom-essentials", "beauty-care", p4],
  ["Natural Linen Cushion", 35, "terra-home", "home-living", p5],
  ["Essential White Sneakers", 78, "thread-and-form", "fashion", p6],
  ["The Daily Notebook", 18, "good-company", "lifestyle", p7],
  ["Ribbed Terracotta Vase", 42, "terra-home", "home-living", p8],
  ["Classic Leather Crossbody", 95, "thread-and-form", "accessories", p9],
  ["Weekend Cotton Sweatshirt", 54, "thread-and-form", "fashion", p10],
  ["Mini Portable Speaker", 59, "studio-tech", "electronics", p11],
  ["Daily Hydrating Moisturizer", 26, "bloom-essentials", "beauty-care", p12],
  ["The Bedside Table Lamp", 68, "terra-home", "home-living", p13],
  ["Everyday Gold Hoops", 32, "thread-and-form", "accessories", p14],
  ["On-the-Go Water Bottle", 29, "good-company", "lifestyle", p15],
  ["Natural Wooden Hairbrush", 19, "bloom-essentials", "beauty-care", p16],
  ["Cloud Cotton Towel Set", 46, "terra-home", "home-living", p17],
  ["Minimal Leather Watch", 85, "good-company", "accessories", p18],
  ["Silent Wireless Mouse", 34, "studio-tech", "electronics", p19],
  ["Slow Sunday Scented Candle", 22, "bloom-essentials", "beauty-care", p20],
  ["Handwoven Storage Basket", 38, "terra-home", "home-living", p21],
  ["Soft Knit Cardigan", 64, "thread-and-form", "fashion", p22],
  ["Pocket Digital Camera", 169, "studio-tech", "electronics", p23],
  ["Move Well Yoga Set", 48, "good-company", "lifestyle", p24],
];
export const products: Product[] = seeds.map(
  ([title, price, storeSlug, category, image, originalPrice], i) => ({
    id: String(i + 1),
    title,
    price,
    storeSlug,
    category,
    image,
    ...(originalPrice === undefined ? {} : { originalPrice }),
    rating: [4.9, 4.8, 4.7, 4.9, 4.6][i % 5] ?? 4.8,
    reviews: 42 + i * 7,
    stock: 12 + i,
    description: `Meet your new everyday favorite. The ${title.toLowerCase()} brings thoughtful design and lasting quality to your routine. Carefully selected by ${stores.find((s) => s.slug === storeSlug)?.name}, with a focus on beautiful details, practical comfort, and materials that feel just right.`,
    ...(i === 0
      ? { badge: "Bestseller" }
      : i === 2
        ? { badge: "Sale" }
        : i === 3
          ? { badge: "New" }
          : {}),
  }),
);
