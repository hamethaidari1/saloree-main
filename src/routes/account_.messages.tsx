import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { SupportInbox } from "@/components/support/inbox";
import { headT } from "@/i18n/head";
import { requireAuth } from "@/lib/auth";
import { initialView, parseMessagesSearch, searchFor } from "@/lib/support-search";
import { ordersService } from "@/services/orders";

// `account_` = not nested inside /account (which has no outlet); same URL prefix.
export const Route = createFileRoute("/account_/messages")({
  ssr: false,
  beforeLoad: requireAuth(),
  validateSearch: parseMessagesSearch,
  head: ({ matches }) => ({
    meta: [
      { title: headT(matches, "support")("metaTitle") },
      { name: "robots", content: "noindex" },
    ],
  }),
  pendingComponent: CatalogSkeleton,
  component: MessagesPage,
});

function MessagesPage() {
  const { t } = useTranslation("support");
  const { user } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/account/messages" });
  // Only the user's own orders can be referenced.
  const orders = useQuery({
    queryKey: ["orders", "mine", user.id],
    queryFn: ordersService.getMyOrders,
    retry: false,
  });
  return (
    <main className="market-container pb-16">
      <p className="support-help-link">
        <Link to="/help">{t("helpCenter")}</Link>
      </p>
      <h1 className="page-title">{t("title")}</h1>
      <p className="page-subtitle">{t("subtitle")}</p>
      <div className="mt-6">
        {orders.isPending ? (
          <CatalogSkeleton />
        ) : (
          <SupportInbox
            audience="customer"
            userId={user.id}
            orders={(orders.data ?? []).map((o) => ({ id: o.id, created_at: o.created_at }))}
            initial={initialView(search)}
            onViewChange={(v) => void navigate({ search: searchFor(v), replace: true })}
          />
        )}
      </div>
    </main>
  );
}
