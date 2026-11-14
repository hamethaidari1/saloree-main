import { createFileRoute } from "@tanstack/react-router";
import { handleTrack } from "@/lib/track.server";

/** Storefront page views (see src/lib/track.server.ts). Always 204, empty body. */
export const Route = createFileRoute("/api/track")({
  server: {
    handlers: {
      POST: ({ request }) => handleTrack(request),
    },
  },
});
