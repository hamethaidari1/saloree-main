import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { CarriersPanel } from "@/components/admin/carriers-panel";
import { CommissionPanel } from "@/components/admin/commission-panel";
import { TemplatesPanel } from "@/components/admin/templates-panel";
import {
  CompanyDetailsPanel,
  FinanceOrdersPanel,
  FinanceOverviewPanel,
} from "@/components/staff/finance-panels";
import { NoAccess, StaffShell } from "@/components/staff/staff-shell";
import { SellerApplicationsPanel } from "@/components/staff/seller-applications";
import { PayoutSettingsPanel, PayoutsFinancePanel } from "@/components/staff/payouts-finance";
import { requirePanel } from "@/lib/auth";

const TABS = [
  ["overview", "Overview"],
  ["orders", "Orders"],
  ["payouts", "Payouts"],
  ["applications", "Seller applications"],
  ["commission", "Commission"],
  ["carriers", "Carriers"],
  ["templates", "Templates"],
  ["company", "Company details"],
] as const;
type Tab = (typeof TABS)[number][0];
const isTab = (v: unknown): v is Tab => TABS.some(([t]) => t === v);

// `admin_` = not nested inside /admin (which is admin-only); same URL prefix.
export const Route = createFileRoute("/admin_/finance")({
  ssr: false,
  // finance_admin or admin. Signed out → /login; others → "You don't have access".
  beforeLoad: requirePanel("finance"),
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } =>
    isTab(s["tab"]) ? { tab: s["tab"] } : {},
  head: () => ({
    meta: [{ title: "Finance — Saloree" }, { name: "robots", content: "noindex" }],
  }),
  pendingComponent: CatalogSkeleton,
  component: FinancePage,
});

function FinancePage() {
  const { user, roles, allowed } = Route.useRouteContext();
  const { tab = "overview" } = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/finance" });
  if (!allowed) return <NoAccess panel="finance" roles={roles} />;
  return (
    <StaffShell
      panel="finance"
      email={user.email ?? ""}
      roles={roles}
      description="Orders, money, seller payouts, commission, carriers, template prices and company details."
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
          <FinanceOverviewPanel />
        </TabsContent>
        <TabsContent value="orders" className="mt-6">
          <FinanceOrdersPanel />
        </TabsContent>
        <TabsContent value="payouts" className="mt-6">
          <PayoutsFinancePanel />
        </TabsContent>
        <TabsContent value="applications" className="mt-6">
          {/* Finance reads the same list and details; only admin/content_admin decide. */}
          <SellerApplicationsPanel canReview={roles.includes("admin")} />
        </TabsContent>
        <TabsContent value="commission" className="mt-6 grid gap-6">
          <CommissionPanel />
          <PayoutSettingsPanel />
        </TabsContent>
        <TabsContent value="carriers" className="mt-6">
          <CarriersPanel />
        </TabsContent>
        <TabsContent value="templates" className="mt-6">
          <TemplatesPanel />
        </TabsContent>
        <TabsContent value="company" className="mt-6">
          <CompanyDetailsPanel />
        </TabsContent>
      </Tabs>
    </StaffShell>
  );
}
