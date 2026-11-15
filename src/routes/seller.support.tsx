import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useSeller } from "@/components/seller/seller-context";
import { SellerPageHeader } from "@/components/seller/seller-shell";
import { SupportInbox } from "@/components/support/inbox";
import { sellerService } from "@/services/seller";
import { initialView, parseMessagesSearch, searchFor } from "@/lib/support-search";

export const Route = createFileRoute("/seller/support")({
  ssr: false,
  validateSearch: parseMessagesSearch,
  head: () => ({ meta: [{ title: "Support — Saloree" }, { name: "robots", content: "noindex" }] }),
  component: SellerSupportPage,
});

function SellerSupportPage() {
  const { user, stores } = useSeller();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/seller/support" });
  const storeIds = stores.map((s) => s.id);
  // A seller may reference one of their own stores' orders.
  const orders = useQuery({
    queryKey: ["seller", "support-orders", ...storeIds],
    queryFn: () => sellerService.getOrders(storeIds),
    retry: false,
  });
  return (
    <div className="seller-page">
      <SellerPageHeader
        title="Support"
        description="Write to the Saloree team about orders, payouts, your store or anything else."
      />
      <SupportInbox
        audience="seller"
        userId={user.id}
        orders={(orders.data ?? []).map((o) => ({ id: o.id, created_at: o.created_at }))}
        initial={initialView(search)}
        onViewChange={(v) => void navigate({ search: searchFor(v), replace: true })}
      />
    </div>
  );
}
