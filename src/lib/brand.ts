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
