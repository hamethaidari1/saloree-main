import { createFileRoute } from "@tanstack/react-router";
import { handlePageview } from "@/lib/pageview.server";

/** Site-wide page views (see src/lib/pageview.server.ts). Always 204, empty body. */
export const Route = createFileRoute("/api/pageview")({
  server: {
    handlers: {
      POST: ({ request }) => handlePageview(request),
    },
  },
});
