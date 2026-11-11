import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  Search,
  ShoppingBag,
  Heart,
  UserRound,
  Menu,
  ChevronDown,
  Star,
  Plus,
  Minus,
  Truck,
  ShieldCheck,
  PackageCheck,
  Store as StoreIcon,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import logo from "@/assets/saloree-wordmark.png.asset.json";
import { useQuery } from "@tanstack/react-query";
import type { Catalog, Product, Store } from "@/data/catalog";
import { catalogQuery, money } from "@/services/catalog";
import { useAuth } from "@/lib/auth";
import { useCart } from "./cart-context";
const EMPTY_CATALOG: Catalog = { products: [], stores: [], categories: [] };
/** Non-suspending catalog access for layout pieces that render on every page. */
export function useCatalog(): Catalog {
  return useQuery(catalogQuery).data ?? EMPTY_CATALOG;
}
function AccountLink() {
  const { user, ready, isSeller, isAdmin } = useAuth();
  if (ready && user)
    return (
      <Link to={isAdmin ? "/admin" : isSeller ? "/seller" : "/account"} className="header-action">
        <UserRound size={19} />
        <span className="header-action-label">
          {isAdmin ? "Admin" : isSeller ? "My store" : "Account"}
        </span>
      </Link>
    );
  return (
    <Link to="/login" className="header-action">
      <UserRound size={19} />
      <span className="header-action-label">Sign in</span>
    </Link>
  );
}
export function Navbar() {
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState(false);
  const navigate = useNavigate();
  const { items } = useCart();
  const { categories } = useCatalog();
  const count = items.reduce((s, i) => s + i.quantity, 0);
  return (
    <>
      <div className="announcement">
        <Sparkles size={12} />
        <span>Independent stores. Extraordinary finds. All in one place.</span>
      </div>
      <header className="main-header">
        <div className="market-container header-main">
          <Link to="/" aria-label="Saloree home">
            <img src={logo.url} alt="Saloree" className="logo-image" width="135" height="55" />
          </Link>
          <form
            className="search-field"
            onSubmit={(e) => {
              e.preventDefault();
              navigate({ to: "/products", search: { q: query } });
            }}
          >
            <Search size={16} className="text-muted-foreground" />
            <input
              aria-label="Search products and stores"
              placeholder="Search for something you’ll love…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Button type="submit" aria-label="Search" size="icon">
              <ArrowRight />
            </Button>
          </form>
          <div className="header-actions">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Wishlist"
              className="desktop-wishlist"
              onClick={() => toast.info("Save your favorites using the heart on any product.")}
            >
              <Heart size={19} />
            </Button>
            <AccountLink />
            <Link to="/cart" className="header-action" aria-label={`Shopping cart, ${count} items`}>
              <ShoppingBag size={20} />
              {count > 0 && <span className="cart-count">{count}</span>}
              <span className="header-action-label">Cart</span>
            </Link>
            <Button
              variant="ghost"
              size="icon"
              className="mobile-menu-toggle"
              aria-label={menu ? "Close menu" : "Open menu"}
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X /> : <Menu />}
            </Button>
          </div>
        </div>
        <nav aria-label="Main navigation" className="market-container nav-row">
          <Link to="/products" className="flex items-center gap-2">
            <Menu size={14} />
            All categories
            <ChevronDown size={12} />
          </Link>
          <Link to="/products">Discover</Link>
          <Link to="/products" search={{ sort: "newest" }}>
            New arrivals
          </Link>
          <Link to="/products" search={{ sort: "popular" }}>
            Bestsellers
          </Link>
          <Link to="/stores">Our stores</Link>
          <Link to="/products" search={{ sale: true }} className="nav-special">
            <Sparkles size={13} />
            Little prices, big finds
          </Link>
        </nav>
        {menu && (
          <nav
            aria-label="Mobile categories"
            className="market-container grid grid-cols-2 gap-3 py-4"
          >
            {categories.map((c) => (
              <Link
                key={c.slug}
                to="/category/$slug"
                params={{ slug: c.slug }}
                onClick={() => setMenu(false)}
                className="text-xs py-2"
              >
                {c.name}
              </Link>
            ))}
            <Link to="/stores" onClick={() => setMenu(false)} className="text-xs py-2">
              Our stores
            </Link>
          </nav>
        )}
      </header>
    </>
  );
}
export function Footer() {
  const { categories } = useCatalog();
  return (
    <footer className="footer">
      <div className="market-container">
        <div className="footer-columns">
          <div className="footer-about">
            <Link to="/" aria-label="Saloree home">
              <img
                src={logo.url}
                alt="Saloree"
                className="logo-image"
                width="135"
                height="55"
                loading="lazy"
              />
            </Link>
            <p>
              A world of thoughtful finds from independent stores. Something special, for every day.
            </p>
          </div>
          <div>
            <h3>Explore Saloree</h3>
            <Link to="/products" className="footer-link">
              All products
            </Link>
            <Link to="/products" search={{ sort: "newest" }} className="footer-link">
              New arrivals
            </Link>
            <Link to="/stores" className="footer-link">
              Discover stores
            </Link>
            <Link to="/products" search={{ sort: "popular" }} className="footer-link">
              Bestsellers
            </Link>
          </div>
          <div>
            <h3>Shop by category</h3>
            {categories.slice(0, 4).map((c) => (
              <Link
                key={c.slug}
                to="/category/$slug"
                params={{ slug: c.slug }}
                className="footer-link"
              >
                {c.name}
              </Link>
            ))}
          </div>
          <div>
            <h3>A better kind of shopping</h3>
            <p className="text-xs leading-7 text-muted-foreground">
              Independent businesses.
              <br />
              Thoughtfully selected products.
              <br />
              One happy place to shop.
            </p>
            <Link to="/cart" className="footer-link">
              Your shopping bag →
            </Link>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 Saloree. All rights reserved.</span>
          <span>Made for discoveries. Made for you.</span>
        </div>
      </div>
    </footer>
  );
}
export function TrustStrip() {
  return (
    <div className="trust-strip">
      {[
        { icon: StoreIcon, title: "Independent stores", text: "Real people, remarkable products" },
        { icon: ShieldCheck, title: "Shop with confidence", text: "Thoughtfully selected finds" },
        { icon: PackageCheck, title: "One shared cart", text: "All your favorites, together" },
        {
          icon: Heart,
          title: "A little more personal",
          text: "Find something that feels like you",
        },
      ].map(({ icon: Icon, title, text }) => (
        <div className="trust-item" key={title}>
          <Icon />
          <div>
            <strong>{title}</strong>
            <p>{text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
export function SectionHeading({
  title,
  subtitle,
  to = "/products",
  children,
}: {
  title: string;
  subtitle?: string;
  to?: "/products" | "/stores";
  children?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div className="min-w-0">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children ?? (
        <Link to={to}>
          View all
          <ArrowRight size={13} />
        </Link>
      )}
    </div>
  );
}
export function Rating({ rating, reviews }: { rating: number; reviews?: number }) {
  if (!(rating > 0)) return null;
  return (
    <span className="product-rating">
      <Star />
      <span>{rating.toFixed(1)}</span>
      {reviews !== undefined && <span className="review-count">({reviews})</span>}
    </span>
  );
}
export function ProductCard({ product }: { product: Product }) {
  const store = useCatalog().stores.find((s) => s.slug === product.storeSlug);
  const { add } = useCart();
  const [saved, setSaved] = useState(false);
  return (
    <article className="product-card">
      <div className="product-photo">
        {product.badge && (
          <span className={`product-badge ${product.badge.toLowerCase()}`}>{product.badge}</span>
        )}
        <Link to="/product/$id" params={{ id: product.id }} aria-label={`View ${product.title}`}>
          <img src={product.image} alt={product.title} width="384" height="512" loading="lazy" />
        </Link>
        <Button
          size="icon"
          variant="ghost"
          className={`product-save ${saved ? "text-brand" : ""}`}
          aria-label={`${saved ? "Unsave" : "Save"} ${product.title}`}
          aria-pressed={saved}
          title={saved ? "Remove from favorites" : "Save to favorites"}
          onClick={() => {
            setSaved(!saved);
            toast.success(saved ? "Removed from favorites" : "Saved to favorites");
          }}
        >
          <Heart size={15} fill={saved ? "currentColor" : "none"} />
        </Button>
      </div>
      <div className="product-info">
        <Link to="/store/$slug" params={{ slug: product.storeSlug }} className="product-store">
          {store?.name}
        </Link>
        <Link to="/product/$id" params={{ id: product.id }} className="product-title">
          {product.title}
        </Link>
        <Rating rating={product.rating} reviews={product.reviews} />
        <div className="product-bottom">
          <span className="product-price">
            {money(product.price)}
            {product.originalPrice && (
              <span className="old-price">{money(product.originalPrice)}</span>
            )}
          </span>
          <Button
            size="icon"
            variant="ghost"
            className="product-cart"
            title="Add to cart"
            aria-label={`Add ${product.title} to cart`}
            onClick={() => add(product.id)}
          >
            <Plus size={14} />
          </Button>
        </div>
      </div>
    </article>
  );
}
export function StoreCard({ store }: { store: Store }) {
  return (
    <Link to="/store/$slug" params={{ slug: store.slug }} className="store-card">
      <div className={`store-card-cover tone-${store.tone}`}>
        <img
          src={store.image}
          alt={`${store.name} collection`}
          width="384"
          height="512"
          loading="lazy"
        />
      </div>
      <div className="store-card-info">
        <div className="store-identity">
          <span className="store-avatar">{store.initials}</span>
          <div className="min-w-0">
            <h3>{store.name}</h3>
            <p>{store.specialty}</p>
          </div>
        </div>
        <div className="store-card-rating">
          <span>
            {store.rating > 0 && (
              <>
                <Star />
                {store.rating.toFixed(1)}
              </>
            )}
          </span>
          <ArrowRight />
        </div>
      </div>
    </Link>
  );
}
export function QuantityPicker({
  value,
  onChange,
  max,
}: {
  value: number;
  onChange: (q: number) => void;
  max: number;
}) {
  return (
    <div className="quantity-picker">
      <Button
        size="icon"
        variant="ghost"
        aria-label="Decrease quantity"
        disabled={value <= 1}
        onClick={() => onChange(value - 1)}
      >
        <Minus size={13} />
      </Button>
      <span aria-label="Quantity" aria-live="polite">
        {value}
      </span>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Increase quantity"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <Plus size={13} />
      </Button>
    </div>
  );
}
export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state">
      <ShoppingBag />
      <h2>{title}</h2>
      <p>{description}</p>
      <Button asChild>
        <Link to="/products">
          Explore products
          <ArrowRight />
        </Link>
      </Button>
    </div>
  );
}
export function CatalogSkeleton() {
  return (
    <div className="market-container skeleton-grid" aria-label="Loading products">
      {Array.from({ length: 8 }, (_, i) => (
        <div className="skeleton-product" key={i} />
      ))}
    </div>
  );
}
