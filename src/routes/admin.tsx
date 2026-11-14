import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { CategoriesPanel } from "@/components/admin/categories-panel";
import { CarriersPanel } from "@/components/admin/carriers-panel";
import { CommissionPanel } from "@/components/admin/commission-panel";
import { TemplatesPanel } from "@/components/admin/templates-panel";
import { OrdersPanel } from "@/components/admin/orders-panel";
import { OverviewPanel } from "@/components/admin/overview-panel";
import { ProductsPanel } from "@/components/admin/products-panel";
import { StoresPanel } from "@/components/admin/stores-panel";
import { UsersPanel } from "@/components/admin/users-panel";
import { requirePanel } from "@/lib/auth";
import { NoAccess, StaffShell } from "@/components/staff/staff-shell";
import { AuditLogPanel, TeamPanel } from "@/components/staff/team-panels";
import { SellerApplicationsPanel } from "@/components/staff/seller-applications";

const TABS = [
  ["overview", "Overview"],
  ["stores", "Stores"],
  ["applications", "Seller applications"],
  ["products", "Products"],
  ["categories", "Categories"],
  ["users", "Users"],
  ["orders", "Orders"],
  ["carriers", "Carriers"],
  ["templates", "Templates"],
  ["commission", "Commission"],
  ["team", "Team"],
  ["audit", "Audit log"],
] as const;
type Tab = (typeof TABS)[number][0];
const isTab = (v: unknown): v is Tab => TABS.some(([t]) => t === v);

export const Route = createFileRoute("/admin")({
  ssr: false,
  // Signed out → /login. Signed in without 'admin' → "You don't have access".
  beforeLoad: requirePanel("admin"),
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } =>
    isTab(s["tab"]) ? { tab: s["tab"] } : {},
  head: () => ({
    meta: [{ title: "Admin — Saloree" }, { name: "robots", content: "noindex" }],
  }),
  pendingComponent: CatalogSkeleton,
  component: AdminPage,
});

function AdminPage() {
  const { user, roles, allowed } = Route.useRouteContext();
  if (!allowed) return <NoAccess panel="admin" roles={roles} />;
  return <AdminPanel email={user.email ?? ""} roles={roles} userId={user.id} />;
}

function AdminPanel({
  email,
  roles,
  userId,
}: {
  email: string;
  roles: readonly string[];
  userId: string;
}) {
  const { tab = "overview" } = Route.useSearch();
  const navigate = useNavigate({ from: "/admin" });
  return (
    <StaffShell
      panel="admin"
      email={email}
      roles={roles}
      description="Everything: technical settings, team and all panels."
    >
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
        <TabsContent value="applications" className="mt-6">
          <SellerApplicationsPanel canReview />
        </TabsContent>
        <TabsContent value="products" className="mt-6">
          <ProductsPanel canDelete />
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
        <TabsContent value="carriers" className="mt-6">
          <CarriersPanel />
        </TabsContent>
        <TabsContent value="templates" className="mt-6">
          <TemplatesPanel />
        </TabsContent>
        <TabsContent value="commission" className="mt-6">
          <CommissionPanel />
        </TabsContent>
        <TabsContent value="team" className="mt-6">
          <TeamPanel myUserId={userId} />
        </TabsContent>
        <TabsContent value="audit" className="mt-6">
          <AuditLogPanel />
        </TabsContent>
      </Tabs>
    </StaffShell>
  );
}
