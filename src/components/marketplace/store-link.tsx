import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";
import { storePublicAddress, storeUrl } from "@/lib/host";
import { useStoreSlug } from "@/lib/store-mode";

/**
 * Link to a store that does the right thing in either mode: on the
 * marketplace it opens /store/<slug>; on a store's own site it goes home
 * for that store, and to another store's own address otherwise.
 */
export function StoreLink({
  slug,
  className,
  children,
}: {
  slug: string;
  className?: string;
  children: ReactNode;
}) {
  const current = useStoreSlug();
  if (current === slug)
    return (
      <Link to="/" className={className}>
        {children}
      </Link>
    );
  if (current)
    return (
      <a href={storeUrl(slug)} className={className}>
        {children}
      </a>
    );
  return (
    <Link to="/store/$slug" params={{ slug }} className={className}>
      {children}
    </Link>
  );
}

/** The store's own address (e.g. "nextgen-tech.saloree.com") as a working link. */
export function StoreAddressLink({ slug, className }: { slug: string; className?: string }) {
  const address = storePublicAddress(slug);
  return (
    <a href={storeUrl(slug)} className={className ?? "store-address-link"}>
      <ExternalLink size={12} aria-hidden className="rtl:-scale-x-100" />
      <span className="truncate">
        {address ? address.replace(/^https:\/\//, "") : storeUrl(slug)}
      </span>
    </a>
  );
}
