import { headT } from "@/i18n/head";
import { createFileRoute } from "@tanstack/react-router";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { OrderConfirmation } from "@/components/marketplace/order-confirmation";
import { requireAuth } from "@/lib/auth";

export const Route = createFileRoute("/order-confirmation/$groupId")({
  ssr: false,
  beforeLoad: requireAuth(),
  head: ({ matches }) => ({
    meta: [
      { title: headT(matches, "orders")("confirmation.metaTitle") },
      { name: "robots", content: "noindex" },
    ],
  }),
  pendingComponent: CatalogSkeleton,
  component: ConfirmationPage,
});

function ConfirmationPage() {
  const { groupId } = Route.useParams();
  return <OrderConfirmation groupId={groupId} />;
}
