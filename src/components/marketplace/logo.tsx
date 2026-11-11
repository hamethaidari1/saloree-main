import { LOGO, LOGO_ON_DARK } from "@/lib/brand";

const DISPLAY_WIDTH = 134;

/**
 * The one place the logo <img> is rendered. `onDark` uses the white wordmark
 * (header); the default red one is for light surfaces (footer). Width/height
 * follow the file's own ratio and reserve space before it loads.
 */
export function Logo({ lazy = false, onDark = false }: { lazy?: boolean; onDark?: boolean }) {
  const logo = onDark ? LOGO_ON_DARK : LOGO;
  return (
    <img
      src={logo.src}
      alt={logo.alt}
      width={DISPLAY_WIDTH}
      height={Math.round((DISPLAY_WIDTH * logo.height) / logo.width)}
      className="logo-image"
      decoding="async"
      {...(lazy ? { loading: "lazy" as const } : { fetchPriority: "high" as const })}
    />
  );
}
