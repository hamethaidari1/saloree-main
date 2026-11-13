import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { Store } from "@/data/catalog";
import { storeAddressLabel } from "@/lib/host";

/**
 * Tracks whether an image failed. Also catches a failure that happened
 * before hydration (React's onError is not attached yet at that point).
 */
function useImageFailed(src: string | null | undefined) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    setFailed(false);
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0 && img.getAttribute("src")) setFailed(true);
  }, [src]);
  return { failed, ref, onError: () => setFailed(true) };
}

/** Logo, or the store's initials when there is no logo or it fails to load. Fixed size. */
function StoreBadge({ store, size }: { store: Store; size: "md" | "lg" }) {
  const logo = useImageFailed(store.logo);
  return (
    <span className={`store-badge store-badge-${size}`} aria-hidden="true">
      {store.logo && !logo.failed ? (
        <img
          ref={logo.ref}
          src={store.logo}
          alt=""
          width={88}
          height={88}
          loading="lazy"
          decoding="async"
          onError={logo.onError}
        />
      ) : (
        store.initials
      )}
    </span>
  );
}

/**
 * One self-contained card that is a single link to the store. The store's own
 * address is shown as a text label inside it (a link can't be nested in a link).
 */
export function StoreCard({ store }: { store: Store }) {
  const banner = useImageFailed(store.banner);
  const address = storeAddressLabel(store.slug);
  const showBanner = Boolean(store.banner) && !banner.failed;
  return (
    <Link
      to="/store/$slug"
      params={{ slug: store.slug }}
      className="store-card"
      data-banner={showBanner ? "image" : "fallback"}
    >
      <span className="store-card-banner">
        {showBanner ? (
          <img
            ref={banner.ref}
            src={store.banner ?? undefined}
            alt=""
            width={640}
            height={360}
            loading="lazy"
            decoding="async"
            onError={banner.onError}
          />
        ) : (
          <span className="store-card-banner-fallback" data-testid="store-banner-fallback">
            <StoreBadge store={store} size="lg" />
          </span>
        )}
      </span>
      <span className="store-card-body">
        <StoreBadge store={store} size="md" />
        <span className="store-card-text">
          {/* dir: a long Latin name on an RTL page (or the reverse) keeps its
              beginning and is cut at its own end; alignment still follows the page. */}
          <h3 className="store-card-name" title={store.name} dir="auto">
            {store.name}
          </h3>
          {store.specialty && (
            <span className="store-card-category" dir="auto">
              {store.specialty}
            </span>
          )}
          {/* A domain always reads left-to-right. */}
          <span className="store-card-address" title={address} dir="ltr">
            {address}
          </span>
        </span>
      </span>
    </Link>
  );
}
