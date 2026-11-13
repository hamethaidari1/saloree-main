import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";

/** Row-2 shortcuts; also listed in the drawer. */
export function NavLinkItems({
  className,
  onNavigate,
}: {
  className: string;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation("nav");
  return (
    <>
      <Link to="/products" search={{ sale: true }} className={className} onClick={onNavigate}>
        {t("deals")}
      </Link>
      <Link to="/products" search={{ sort: "newest" }} className={className} onClick={onNavigate}>
        {t("newArrivals")}
      </Link>
      <Link to="/products" search={{ sort: "popular" }} className={className} onClick={onNavigate}>
        {t("bestsellers")}
      </Link>
      <Link to="/stores" className={className} onClick={onNavigate}>
        {t("ourStores")}
      </Link>
      <Link to="/help" className={className} onClick={onNavigate}>
        {t("customerService")}
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
  const { t } = useTranslation("nav");
  return (
    <Link to="/register" search={{ role: "seller" }} className={className} onClick={onNavigate}>
      {t("sell")}
    </Link>
  );
}
