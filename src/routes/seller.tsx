import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CatalogSkeleton, EmptyState } from "@/components/marketplace/shared";
import { requireAuth } from "@/lib/auth";
import { sellerService } from "@/services/orders";
import { SignOutButton } from "@/components/marketplace/auth-form";

export const Route = createFileRoute("/seller")({
  ssr: false,
  beforeLoad: requireAuth("seller"),
  head: () => ({
    meta: [{ title: "Your store — Saloree" }, { name: "robots", content: "noindex" }],
  }),
  pendingComponent: CatalogSkeleton,
  component: SellerPage,
});

function SellerPage() {
  const { user } = Route.useRouteContext();
  const stores = useQuery({
    queryKey: ["stores", "mine", user.id],
    queryFn: sellerService.getMyStores,
  });
  return (
    <main className="market-container pb-16">
      <div className="account-header">
        <div>
          <h1 className="page-title">Seller dashboard</h1>
          <p className="page-subtitle">{user.email}</p>
        </div>
        <SignOutButton />
      </div>
      <h2 className="text-xl font-semibold mt-10 mb-4">Your stores</h2>
      {stores.isPending ? (
        <CatalogSkeleton />
      ) : stores.isError ? (
        <p role="alert" className="auth-error">
          Your stores could not be loaded.
        </p>
      ) : !stores.data.length ? (
        <EmptyState
          title="No store yet"
          description="Store setup and product management are the next step."
        />
      ) : (
        <ul className="order-list">
          {stores.data.map((s) => (
            <li key={s.id} className="order-summary">
              <div className="summary-row">
                <strong>{s.name}</strong>
                <span>{s.status}</span>
              </div>
              {s.status === "published" && (
                <Link to="/store/$slug" params={{ slug: s.slug }} className="text-xs text-primary">
                  View storefront →
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
