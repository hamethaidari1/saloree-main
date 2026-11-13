import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { CategoriesPanel } from "@/components/admin/categories-panel";
import { ProductsPanel } from "@/components/admin/products-panel";
import { StoresPanel } from "@/components/admin/stores-panel";
import { ContentPanel } from "@/components/staff/content-panel";
import {
  MarketplaceOverview,
  SellersPanel,
  SiteTextsPanel,
} from "@/components/staff/marketplace-panels";
import { NoAccess, StaffShell } from "@/components/staff/staff-shell";
import { requirePanel } from "@/lib/auth";

const TABS = [
  ["overview", "Overview"],
  ["stores", "Stores"],
  ["products", "Products"],
  ["categories", "Categories"],
  ["homepage", "Homepage"],
  ["texts", "Site texts"],
  ["sellers", "Sellers"],
] as const;
type Tab = (typeof TABS)[number][0];
const isTab = (v: unknown): v is Tab => TABS.some(([t]) => t === v);

// `admin_` = not nested inside /admin (which is admin-only); same URL prefix.
export const Route = createFileRoute("/admin_/marketplace")({
  ssr: false,
  // content_admin or admin. Signed out → /login; others → "You don't have access".
  beforeLoad: requirePanel("marketplace"),
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } =>
    isTab(s["tab"]) ? { tab: s["tab"] } : {},
  head: () => ({
    meta: [{ title: "Marketplace — Saloree" }, { name: "robots", content: "noindex" }],
  }),
  pendingComponent: CatalogSkeleton,
  component: MarketplacePage,
});

function MarketplacePage() {
  const { user, roles, allowed } = Route.useRouteContext();
  const { tab = "overview" } = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/marketplace" });
  if (!allowed) return <NoAccess panel="marketplace" roles={roles} />;
  const isAdmin = roles.includes("admin");
  return (
    <StaffShell
      panel="marketplace"
      email={user.email ?? ""}
      roles={roles}
      description="Sellers, stores, products, categories and home page content."
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
          <MarketplaceOverview />
        </TabsContent>
        <TabsContent value="stores" className="mt-6">
          {/* The database refuses status changes on your own store unless you're an admin. */}
          <StoresPanel myUserId={user.id} canChangeOwn={isAdmin} />
        </TabsContent>
        <TabsContent value="products" className="mt-6">
          <ProductsPanel canDelete={isAdmin} />
        </TabsContent>
        <TabsContent value="categories" className="mt-6">
          <CategoriesPanel />
        </TabsContent>
        <TabsContent value="homepage" className="mt-6 grid gap-10">
          <ContentPanel table="hero_slides" />
          <ContentPanel table="homepage_sections" />
          <ContentPanel table="promo_banners" />
          <ContentPanel table="footer_links" />
        </TabsContent>
        <TabsContent value="texts" className="mt-6">
          <SiteTextsPanel />
        </TabsContent>
        <TabsContent value="sellers" className="mt-6">
          <SellersPanel />
        </TabsContent>
      </Tabs>
    </StaffShell>
  );
}
