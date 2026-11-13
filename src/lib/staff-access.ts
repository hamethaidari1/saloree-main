/**
 * Who may open which staff panel — the ONE place these rules live.
 * The database enforces the same rules (RLS); this only keeps the screens in
 * step so nobody sees a panel whose every call would fail.
 */

export const STAFF_ROLES = ["admin", "content_admin", "finance_admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export type PanelId = "admin" | "marketplace" | "finance";

export interface StaffPanel {
  id: PanelId;
  path: "/admin" | "/admin/marketplace" | "/admin/finance";
  label: string;
  /** Any one of these roles opens the panel. */
  roles: readonly StaffRole[];
}

/** In landing-page priority order. */
export const STAFF_PANELS: readonly StaffPanel[] = [
  { id: "admin", path: "/admin", label: "Admin", roles: ["admin"] },
  {
    id: "marketplace",
    path: "/admin/marketplace",
    label: "Marketplace",
    roles: ["content_admin", "admin"],
  },
  { id: "finance", path: "/admin/finance", label: "Finance", roles: ["finance_admin", "admin"] },
];

export const isStaffRole = (role: string): role is StaffRole =>
  (STAFF_ROLES as readonly string[]).includes(role);

export const isStaff = (roles: readonly string[]) => roles.some(isStaffRole);

export function panelById(id: PanelId): StaffPanel {
  const p = STAFF_PANELS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown panel ${id}`);
  return p;
}

export const canOpenPanel = (id: PanelId, roles: readonly string[]) =>
  panelById(id).roles.some((r) => roles.includes(r));

/** Every panel these roles can open, in priority order. */
export const panelsFor = (roles: readonly string[]) =>
  STAFF_PANELS.filter((p) => p.roles.some((r) => roles.includes(r)));

/**
 * Where a staff member lands after sign-in: their own panel. An admin goes to
 * /admin (which links to the other two); content → marketplace; finance →
 * finance. Null for non-staff.
 */
export function staffHome(roles: readonly string[]): StaffPanel["path"] | null {
  if (roles.includes("admin")) return "/admin";
  if (roles.includes("content_admin")) return "/admin/marketplace";
  if (roles.includes("finance_admin")) return "/admin/finance";
  return null;
}

export type PanelAccess = "login" | "forbidden" | "allowed";

/** Pure guard decision for a panel route. */
export function decidePanelAccess(
  signedIn: boolean,
  roles: readonly string[],
  id: PanelId,
): PanelAccess {
  if (!signedIn) return "login";
  return canOpenPanel(id, roles) ? "allowed" : "forbidden";
}
