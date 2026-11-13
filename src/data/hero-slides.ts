/**
 * Home page hero slides. All visible text lives in translation files
 * (src/locales/<code>/home.json); this file only holds keys, media and links.
 *
 * What the media already contains (checked when the slides were made):
 *  - saloree-home: living-room photo, no text, open space on the inline start.
 *  - saloree-hero-background: banner with product cards and baked-in English
 *    badges ("Independent stores", "One shared cart", "Shop with confidence",
 *    a $15.99 price tag) but no headline; its left ~45% is empty for copy.
 *  - saloree-hero-promo (7 s, no audio): carries its own headlines
 *    ("Small stores.", "Everything you love…", "One shared cart") and the
 *    Saloree logo, so it gets a CTA only, never an overlaid headline.
 * The originals stay in src/assets/Hero-Pic-Video/ and are not imported
 * (except the video, which is already small: 1.7 MB, 1920×640, H.264, faststart).
 */
import home640 from "@/assets/hero/saloree-home-640.webp";
import home1024 from "@/assets/hero/saloree-home-1024.webp";
import home1600 from "@/assets/hero/saloree-home-1600.webp";
import banner640 from "@/assets/hero/saloree-hero-background-640.webp";
import banner1024 from "@/assets/hero/saloree-hero-background-1024.webp";
import banner1600 from "@/assets/hero/saloree-hero-background-1600.webp";
import poster640 from "@/assets/hero/saloree-hero-promo-poster-640.webp";
import poster1280 from "@/assets/hero/saloree-hero-promo-poster-1280.webp";
import promoVideo from "@/assets/Hero-Pic-Video/saloree-hero-promo.mp4";

export interface ResponsiveImage {
  src: string;
  srcSet: string;
  width: number;
  height: number;
}

/** Real routes only (checked by the type system and by a test). */
export type HeroLink = "/products" | "/stores";

interface SlideBase {
  id: string;
  /** home.json key of the image description (alt text / video description). */
  altKey: string;
  /** Where the CTA goes, and its home.json label key. */
  link: HeroLink;
  ctaKey: string;
  /**
   * Copy to overlay (home.json keys). Omitted when the media carries its own
   * headline: then only the CTA is shown.
   */
  copy?: { eyebrowKey?: string; titleKeys: [string] | [string, string]; textKey?: string };
}

export interface ImageSlide extends SlideBase {
  kind: "image";
  image: ResponsiveImage;
}

export interface VideoSlide extends SlideBase {
  kind: "video";
  video: { src: string; type: "video/mp4"; width: number; height: number };
  /** Shown until the video plays, instead of it (reduced motion / Save-Data), or if it fails. */
  poster: ResponsiveImage;
}

export type HeroSlide = ImageSlide | VideoSlide;

/** srcset for widths that exist (never upscaled past the source). */
const srcSet = (entries: [string, number][]) => entries.map(([u, w]) => `${u} ${w}w`).join(", ");

/** Matches the hero's width: full container up to 1280px, minus page gutters. */
export const HERO_SIZES = "(max-width: 1100px) calc(100vw - 48px), 1280px";

export const HERO_SLIDES: readonly HeroSlide[] = [
  {
    id: "home",
    kind: "image",
    image: {
      src: home1600,
      srcSet: srcSet([
        [home640, 640],
        [home1024, 1024],
        [home1600, 1600],
      ]),
      width: 1600,
      height: 853,
    },
    altKey: "hero.imageAlt",
    copy: {
      eyebrowKey: "hero.eyebrow",
      titleKeys: ["hero.titleLine1", "hero.titleLine2"],
      textKey: "hero.text",
    },
    link: "/products",
    ctaKey: "hero.cta",
  },
  {
    id: "stores",
    kind: "image",
    image: {
      src: banner1600,
      srcSet: srcSet([
        [banner640, 640],
        [banner1024, 1024],
        [banner1600, 1600],
      ]),
      width: 1600,
      height: 533,
    },
    altKey: "slides.stores.imageAlt",
    copy: { titleKeys: ["slides.stores.title"], textKey: "slides.stores.text" },
    link: "/stores",
    ctaKey: "slides.stores.cta",
  },
  {
    id: "promo",
    kind: "video",
    video: { src: promoVideo, type: "video/mp4", width: 1920, height: 640 },
    poster: {
      src: poster1280,
      srcSet: srcSet([
        [poster640, 640],
        [poster1280, 1280],
      ]),
      width: 1280,
      height: 427,
    },
    altKey: "slides.promo.videoLabel",
    link: "/products",
    ctaKey: "slides.promo.cta",
  },
];
