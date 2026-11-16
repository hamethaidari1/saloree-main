import { useEffect, useState, type ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import {
  BadgePercent,
  Boxes,
  ChartColumn,
  House,
  LifeBuoy,
  Inbox,
  List,
  LayoutPanelTop,
  Paintbrush,
  Palette,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Store,
  Tag,
  Users,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Logo } from "@/components/marketplace/logo";
import { firstName } from "@/components/marketplace/header/account-menu";
import { SIDEBAR_COLLAPSED_KEY, useSeller } from "./seller-context";
import { VerificationBanner } from "./verification/status";
import { StoreSwitcher } from "./store-switcher";
import { useQuery } from "@tanstack/react-query";
import { sellerDashboardService } from "@/services/seller-dashboard";
import { UnreadBadge } from "@/components/support/notifier";
import { useUnreadCounts } from "@/components/support/use-support";

/** Menu, in order. Only pages backed by real data are listed. */
export const SELLER_NAV = [
  { to: "/seller", label: "Home", icon: House, exact: true },
  { to: "/seller/orders", label: "Orders", icon: Inbox },
  {
    to: "/seller/products",
    label: "Products",
    icon: Tag,
    children: [
      { to: "/seller/products", label: "All products", icon: List },
      { to: "/seller/inventory", label: "Inventory", icon: Boxes },
    ],
  },
  { to: "/seller/customers", label: "Customers", icon: Users },
  { to: "/seller/discounts", label: "Discounts", icon: BadgePercent },
  { to: "/seller/analytics", label: "Analytics", icon: ChartColumn },
  { to: "/seller/payouts", label: "Payouts", icon: Wallet },
  { to: "/seller/support", label: "Support", icon: LifeBuoy },
  { to: "/seller/content", label: "Content", icon: LayoutPanelTop },
  {
    to: "/seller/themes",
    label: "Online Store",
    icon: Store,
    children: [
      { to: "/seller/themes", label: "Themes", icon: Palette },
      { to: "/seller/customize", label: "Customize", icon: Paintbrush },
    ],
  },
] as const;

function NavBody({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { user, store } = useSeller();
  const supportUnread = useUnreadCounts(user.id).data?.mine ?? 0;
  // Pending orders of the ACTIVE store (same cached count as Home).
  const pendingOrders =
    useQuery({
      queryKey: ["seller", "pending-count", store.id],
      queryFn: () => sellerDashboardService.pendingOrdersCount([store.id]),
      retry: false,
    }).data ?? 0;
  const name = String(user.user_metadata?.["full_name"] ?? "").trim() || firstName(user);
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="seller-sidebar-head">
        <Link to="/" aria-label="Saloree home" className="seller-sidebar-logo" onClick={onNavigate}>
          <Logo />
        </Link>
        <StoreSwitcher compact={collapsed} onNavigate={onNavigate} />
      </div>

      <nav aria-label="Seller" className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="grid gap-0.5">
          {SELLER_NAV.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.label}>
                <Link
                  to={item.to}
                  activeOptions={{ exact: "exact" in item && item.exact, includeSearch: false }}
                  className="seller-nav-link"
                  title={collapsed ? item.label : undefined}
                  onClick={onNavigate}
                >
                  <Icon size={18} aria-hidden />
                  <span className="seller-nav-label">{item.label}</span>
                  {item.to === "/seller/orders" && pendingOrders > 0 && (
                    <>
                      <UnreadBadge count={pendingOrders} />
                      <span className="sr-only">, {pendingOrders} pending</span>
                    </>
                  )}
                  {item.to === "/seller/support" && (
                    <>
                      <UnreadBadge count={supportUnread} />
                      {supportUnread > 0 && (
                        <span className="sr-only">, {supportUnread} unread</span>
                      )}
                    </>
                  )}
                </Link>
                {/* Sub-items stay reachable when collapsed: they show as icons. */}
                {"children" in item && (
                  <ul className="seller-nav-sub">
                    {item.children.map((child) => {
                      const ChildIcon = child.icon;
                      return (
                        <li key={child.label}>
                          <Link
                            to={child.to}
                            activeOptions={{ exact: true, includeSearch: false }}
                            className="seller-nav-link seller-nav-sublink"
                            title={collapsed ? child.label : undefined}
                            onClick={onNavigate}
                          >
                            <ChildIcon size={16} aria-hidden />
                            <span className="seller-nav-label">{child.label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="seller-sidebar-foot">
        <Link
          to="/seller/verification"
          className="seller-nav-link"
          title={collapsed ? "Verification" : undefined}
          onClick={onNavigate}
        >
          <ShieldCheck size={18} aria-hidden />
          <span className="seller-nav-label">Verification</span>
        </Link>
        <Link
          to="/seller/settings"
          className="seller-nav-link"
          title={collapsed ? "Settings" : undefined}
          onClick={onNavigate}
        >
          <Settings size={18} aria-hidden />
          <span className="seller-nav-label">Settings</span>
        </Link>
        <div className="seller-user" title={user.email ?? undefined}>
          <span className="seller-store-chip" aria-hidden>
            {(name || "?").slice(0, 1).toUpperCase()}
          </span>
          <span className="seller-nav-label min-w-0">
            <span className="block truncate text-sm font-medium">{name}</span>
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Seller layout: a sidebar that collapses to icons on desktop and becomes a
 * drawer on small screens. Uses logical properties, so it mirrors for RTL.
 */
export function SellerShell({ children }: { children: ReactNode }) {
  const { store, user } = useSeller();
  const onVerificationPage = useRouterState({
    select: (s) => s.location.pathname.replace(/\/$/, "") === "/seller/verification",
  });
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  // Restore the collapsed preference after hydration.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, c ? "0" : "1");
      } catch {
        /* storage unavailable */
      }
      return !c;
    });

  return (
    <div className="seller-shell" data-collapsed={collapsed}>
      <aside className="seller-sidebar" aria-label="Seller menu">
        <NavBody collapsed={collapsed} />
        <Button
          variant="ghost"
          size="icon"
          className="seller-collapse"
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
          aria-pressed={collapsed}
          onClick={toggle}
        >
          {collapsed ? (
            <PanelLeftOpen className="rtl:-scale-x-100" />
          ) : (
            <PanelLeftClose className="rtl:-scale-x-100" />
          )}
        </Button>
      </aside>

      <div className="seller-main">
        <div className="seller-topbar">
          <Button
            variant="outline"
            size="sm"
            aria-haspopup="dialog"
            aria-expanded={drawer}
            onClick={() => setDrawer(true)}
          >
            <Menu />
            Menu
          </Button>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{store.name}</span>
          <Link to="/" className="seller-cta-link shrink-0 py-1.5 text-xs">
            <Store size={14} aria-hidden />
            Shop
          </Link>
        </div>
        {/* Until approved; not on the verification page itself, which says it in full. */}
        {!onVerificationPage && <VerificationBanner userId={user.id} />}
        {children}
      </div>

      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="w-72 max-w-[85vw] p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>Seller menu</SheetTitle>
            <SheetDescription>Navigate your store's pages.</SheetDescription>
          </SheetHeader>
          <NavBody collapsed={false} onNavigate={() => setDrawer(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Title row used at the top of every seller page. */
export function SellerPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string | undefined;
  actions?: ReactNode;
}) {
  return (
    <div className="seller-page-head">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="seller-hint mt-1">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}
