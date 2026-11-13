/**
 * Pages that run as a full-screen app with their own navigation (the seller
 * dashboard) hide the storefront navbar and footer.
 */
export function hidesSiteChrome(pathname: string) {
  return (
    pathname === "/seller" ||
    pathname.startsWith("/seller/") ||
    // The owner's store preview shows the store itself, not the marketplace.
    pathname === "/preview/store"
  );
}
