/**
 * Saloree logos, served from /public so they work on every host.
 *
 * LOGO — red wordmark for light backgrounds (footer, browser-tab icon).
 *   public/logo.png: PNG with transparency, 800 × 335 px.
 * LOGO_ON_DARK — white wordmark for the dark header bar.
 *   public/logo-white.png: PNG with transparency, 480 × 189 px, made from
 *   src/assets/saloree-logo.png.png (trimmed to the artwork, speckles removed).
 */
export const LOGO = {
  src: "/logo.png",
  type: "image/png",
  width: 800,
  height: 335,
  alt: "Saloree",
} as const;

export const LOGO_ON_DARK = {
  src: "/logo-white.png",
  type: "image/png",
  width: 480,
  height: 189,
  alt: "Saloree",
} as const;

/**
 * Site icons: the white wordmark on a brand-green square, made by
 * scripts/generate-favicons.ts. Google's search-result icon needs a square
 * icon (a multiple of 48 px) declared on the home page; /favicon.ico is
 * checked too. Fixed root URLs, no query strings.
 */
export const SITE_THEME_COLOR = "#002e28";
/** Square, opaque, 512 x 512: the Organization logo for search engines. */
export const SITE_LOGO_SQUARE = "/icon-512.png";
export const SITE_ICON_LINKS = [
  { rel: "icon", href: "/favicon.ico", sizes: "48x48" },
  { rel: "icon", type: "image/png", sizes: "48x48", href: "/favicon-48x48.png" },
  { rel: "icon", type: "image/png", sizes: "96x96", href: "/favicon-96x96.png" },
  { rel: "icon", type: "image/png", sizes: "192x192", href: "/icon-192.png" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  { rel: "manifest", href: "/site.webmanifest" },
];
