import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { SignOutButton } from "@/components/marketplace/auth-form";
import { CategoriesPanel } from "@/components/admin/categories-panel";
import { CommissionPanel } from "@/components/admin/commission-panel";
import { OrdersPanel } from "@/components/admin/orders-panel";
import { OverviewPanel } from "@/components/admin/overview-panel";
import { ProductsPanel } from "@/components/admin/products-panel";
import { StoresPanel } from "@/components/admin/stores-panel";
import { UsersPanel } from "@/components/admin/users-panel";
import { requireRoleOrForbid } from "@/lib/auth";

const TABS = [
  ["overview", "Overview"],
  ["stores", "Stores"],
  ["products", "Products"],
  ["categories", "Categories"],
  ["users", "Users"],
  ["orders", "Orders"],
  ["commission", "Commission"],
] as const;
type Tab = (typeof TABS)[number][0];
const isTab = (v: unknown): v is Tab => TABS.some(([t]) => t === v);

export const Route = createFileRoute("/admin")({
  ssr: false,
  // Signed out → /login. Signed in without 'admin' → "not allowed" screen.
  beforeLoad: requireRoleOrForbid("admin"),
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } =>
    isTab(s["tab"]) ? { tab: s["tab"] } : {},
  head: () => ({
    meta: [{ title: "Admin — Saloree" }, { name: "robots", content: "noindex" }],
  }),
  pendingComponent: CatalogSkeleton,
  component: AdminPage,
});

function AdminPage() {
  const { user, allowed } = Route.useRouteContext();
  if (!allowed) return <NotAllowed />;
  return <AdminPanel email={user.email ?? ""} />;
}

function NotAllowed() {
  return (
    <main className="market-container auth-page">
      <div className="auth-card text-center" role="alert">
        <ShieldAlert className="mx-auto mb-4 text-destructive" size={32} aria-hidden />
        <h1 className="page-title">Not allowed</h1>
        <p className="page-subtitle">
          This area is for Saloree administrators. Your account doesn't have admin access.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button asChild>
            <Link to="/">Back to shopping</Link>
          </Button>
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}

function AdminPanel({ email }: { email: string }) {
  const { tab = "overview" } = Route.useSearch();
  const navigate = useNavigate({ from: "/admin" });
  return (
    <main className="market-container pb-16">
      <div className="account-header">
        <div>
          <h1 className="page-title">Admin</h1>
          <p className="page-subtitle">{email}</p>
        </div>
        <SignOutButton />
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) => isTab(v) && navigate({ search: { tab: v }, replace: true })}
        className="mt-8"
      >
        <TabsList className="admin-tabs">
          {TABS.map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview" className="mt-6">
          <OverviewPanel />
        </TabsContent>
        <TabsContent value="stores" className="mt-6">
          <StoresPanel />
        </TabsContent>
        <TabsContent value="products" className="mt-6">
          <ProductsPanel />
        </TabsContent>
        <TabsContent value="categories" className="mt-6">
          <CategoriesPanel />
        </TabsContent>
        <TabsContent value="users" className="mt-6">
          <UsersPanel />
        </TabsContent>
        <TabsContent value="orders" className="mt-6">
          <OrdersPanel />
        </TabsContent>
        <TabsContent value="commission" className="mt-6">
          <CommissionPanel />
        </TabsContent>
      </Tabs>
    </main>
  );
}
