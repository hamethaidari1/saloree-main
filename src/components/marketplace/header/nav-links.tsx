import { Link } from "@tanstack/react-router";

/** Row-2 shortcuts; also listed in the drawer. */
export function NavLinkItems({
  className,
  onNavigate,
}: {
  className: string;
  onNavigate?: () => void;
}) {
  return (
    <>
      <Link to="/products" search={{ sale: true }} className={className} onClick={onNavigate}>
        Deals
      </Link>
      <Link to="/products" search={{ sort: "newest" }} className={className} onClick={onNavigate}>
        New arrivals
      </Link>
      <Link to="/products" search={{ sort: "popular" }} className={className} onClick={onNavigate}>
        Bestsellers
      </Link>
      <Link to="/stores" className={className} onClick={onNavigate}>
        Our stores
      </Link>
      <Link to="/help" className={className} onClick={onNavigate}>
        Customer Service
      </Link>
    </>
  );
}

export function SellLink({
  className,
  onNavigate,
}: {
  className: string;
  onNavigate?: () => void;
}) {
  return (
    <Link to="/register" search={{ role: "seller" }} className={className} onClick={onNavigate}>
      Sell on Saloree
    </Link>
  );
}
