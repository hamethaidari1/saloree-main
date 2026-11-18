/**
 * Nitro build options (read by nitro/vite next to vite.config.ts).
 *
 * Site icons (favicon, Google search result icon, home-screen icons, manifest)
 * keep fixed URLs, so they can't be cached forever like the hashed /assets/
 * files: one week, then revalidated in the background. Only the Vercel build
 * reads `vercel.config`; it is merged ahead of Nitro's own routes.
 */
const ICON_FILES =
  "favicon\\.ico|favicon-48x48\\.png|favicon-96x96\\.png|icon-192\\.png|icon-512\\.png|apple-touch-icon\\.png|site\\.webmanifest";

export default {
  vercel: {
    config: {
      routes: [
        {
          src: `^/(${ICON_FILES})$`,
          headers: {
            "cache-control": "public, max-age=604800, stale-while-revalidate=86400",
          },
          continue: true,
        },
      ],
    },
  },
};
