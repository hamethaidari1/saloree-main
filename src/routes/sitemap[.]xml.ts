import { createFileRoute } from "@tanstack/react-router";
import { handleSitemap } from "@/lib/sitemap.server";

/** /sitemap.xml (and /sitemap.xml?part=N when there are more than 5,000 URLs). */
export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: ({ request }) => handleSitemap(request),
    },
  },
});
