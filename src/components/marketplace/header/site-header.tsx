import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, Package, ShoppingCart } from "lucide-react";
import { useCart } from "../cart-context";
import { Logo } from "../logo";
import { AccountMenu, MobileAccountLink } from "./account-menu";
import { DeliverTo } from "./country-picker";
import { LanguageSelect } from "./language-select";
import { NavDrawer } from "./nav-drawer";
import { NavLinkItems, SellLink } from "./nav-links";
import { SearchBar } from "./search-bar";

function CartLink() {
  const { items } = useCart();
  const count = items.reduce((s, i) => s + i.quantity, 0);
  return (
    <Link
      to="/cart"
      className="nav-hit relative"
      aria-label={`Cart, ${count} ${count === 1 ? "item" : "items"}`}
    >
      <ShoppingCart size={26} aria-hidden className="rtl:-scale-x-100" />
      {count > 0 && (
        <span className="nav-cart-badge" aria-hidden>
          {count > 99 ? "99+" : count}
        </span>
      )}
      <span className="nav-strong hidden self-end pb-1 sm:block">Cart</span>
    </Link>
  );
}

/**
 * Two-row marketplace header. Large screens: everything in row 1 + shortcut
 * row 2. Small screens: menu, logo, "Sign in ›" and cart; then a full-width
 * search row and a "Deliver to" strip. Categories and language are in the drawer.
 */
export function SiteHeader() {
  const [drawer, setDrawer] = useState(false);
  return (
    <header className="site-header">
      <div className="market-container flex min-h-[60px] items-center gap-1 py-1.5 lg:gap-2">
        <div className="lg:hidden">
          <button
            type="button"
            className="nav-hit"
            aria-label="Open menu"
            aria-haspopup="dialog"
            aria-expanded={drawer}
            onClick={() => setDrawer(true)}
          >
            <Menu size={24} aria-hidden />
          </button>
        </div>
        <Link to="/" aria-label="Saloree home" className="nav-hit shrink-0">
          <span className="nav-logo">
            <Logo onDark />
          </span>
        </Link>
        <div className="hidden lg:block">
          <DeliverTo />
        </div>
        <div className="mx-2 hidden min-w-0 flex-1 lg:block">
          <SearchBar />
        </div>
        <div className="hidden lg:block">
          <LanguageSelect />
        </div>
        <div className="hidden lg:block">
          <AccountMenu />
        </div>
        <div className="hidden lg:block">
          <Link to="/account" hash="my-orders" className="nav-hit">
            <Package size={18} aria-hidden className="mt-2" />
            <span className="nav-strong">Orders</span>
          </Link>
        </div>
        <div className="ms-auto min-w-0 lg:hidden">
          <MobileAccountLink />
        </div>
        <div className="shrink-0">
          <CartLink />
        </div>
      </div>

      {/* Small screens: full-width search, then the delivery strip. */}
      <div className="market-container pb-2.5 lg:hidden">
        <SearchBar compact />
      </div>
      <div className="nav-strip lg:hidden">
        <div className="market-container">
          <DeliverTo variant="strip" />
        </div>
      </div>

      <nav aria-label="Shop shortcuts" className="nav-sub hidden lg:block">
        <div className="market-container flex items-center gap-1 overflow-x-auto">
          <button
            type="button"
            className="nav-hit font-bold"
            aria-haspopup="dialog"
            aria-expanded={drawer}
            onClick={() => setDrawer(true)}
          >
            <Menu size={18} aria-hidden />
            All
          </button>
          <NavLinkItems className="nav-hit" />
          <SellLink className="nav-hit ms-auto font-bold" />
        </div>
      </nav>

      <NavDrawer open={drawer} onOpenChange={setDrawer} />
    </header>
  );
}
