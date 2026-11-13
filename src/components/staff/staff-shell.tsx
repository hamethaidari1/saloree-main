import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/marketplace/auth-form";
import { panelById, panelsFor, staffHome, type PanelId } from "@/lib/staff-access";

const PANEL_ROLES_TEXT: Record<PanelId, string> = {
  admin: "the admin role",
  marketplace: "the content admin or admin role",
  finance: "the finance admin or admin role",
};

/** Links to every panel this person can open (only shown with 2+ panels). */
export function PanelSwitcher({ current, roles }: { current: PanelId; roles: readonly string[] }) {
  const panels = panelsFor(roles);
  if (panels.length < 2) return null;
  return (
    <nav aria-label="Staff panels" className="staff-switcher">
      {panels.map((p) => (
        <Link
          key={p.id}
          to={p.path}
          className="staff-switcher-link"
          aria-current={p.id === current ? "page" : undefined}
        >
          {p.label}
        </Link>
      ))}
    </nav>
  );
}

/** Header shared by the three staff panels. */
export function StaffShell({
  panel,
  email,
  roles,
  description,
  children,
}: {
  panel: PanelId;
  email: string;
  roles: readonly string[];
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="market-container pb-16">
      <div className="account-header staff-header">
        <div className="min-w-0">
          <h1 className="page-title">{panelById(panel).label}</h1>
          <p className="page-subtitle">
            {description} <span className="staff-email">· {email}</span>
          </p>
        </div>
        <div className="staff-header-actions">
          <PanelSwitcher current={panel} roles={roles} />
          <SignOutButton />
        </div>
      </div>
      {children}
    </main>
  );
}

/** Signed in, but without a role for this panel. */
export function NoAccess({ panel, roles }: { panel: PanelId; roles: readonly string[] }) {
  const home = staffHome(roles);
  return (
    <main className="market-container auth-page">
      <div className="auth-card text-center" role="alert">
        <ShieldAlert className="mx-auto mb-4 text-destructive" size={32} aria-hidden />
        <h1 className="page-title">You don't have access</h1>
        <p className="page-subtitle">
          The {panelById(panel).label} panel needs {PANEL_ROLES_TEXT[panel]}. Ask an administrator
          if you think you should have it.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {home && home !== panelById(panel).path ? (
            <Button asChild>
              <Link to={home}>Go to your panel</Link>
            </Button>
          ) : (
            <Button asChild>
              <Link to="/">Back to shopping</Link>
            </Button>
          )}
          <SignOutButton />
        </div>
      </div>
    </main>
  );
}
