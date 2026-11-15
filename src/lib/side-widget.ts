/**
 * The floating side widget (Help · Feedback · Top): where it shows. Pure, so
 * the rule is tested without rendering.
 */

/** Pages where it never shows: paying, signing in, dashboards and the order confirmation. */
const HIDDEN_PREFIXES = [
  "/checkout",
  "/seller",
  "/admin",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
  "/auth",
  "/order-confirmation",
  "/preview",
];

export function showsSideWidget(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return !HIDDEN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/** The Top button appears after this much scrolling. */
export const TOP_AFTER_PX = 400;

/** "/product/x?ref=1#reviews" → "/product/x": never a query string or a hash. */
export function pathOnly(path: string): string {
  const p = path.split(/[?#]/)[0] ?? "/";
  return p.startsWith("/") ? p.slice(0, 300) : "/";
}
