import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useEffect, type MouseEvent } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { getStoreSlugFromHost, hostConfig } from "@/lib/host";
import { useWishlistIds, useWishlistToggle } from "@/hooks/use-wishlist";
import {
  mainSiteSaveSignInUrl,
  pendingSaveFromUrl,
  rememberPendingSave,
  takePendingSave,
  wishlistErrorKind,
  withoutSaveParam,
} from "@/services/wishlist";

/** The error in plain words; unknown errors keep the database's own message. */
export function wishlistErrorMessage(t: TFunction, error: unknown): string {
  const kind = wishlistErrorKind(error);
  if (kind) return t(`wishlist.errors.${kind}`, { ns: "product" });
  const message =
    error && typeof error === "object" && "message" in error && typeof error.message === "string"
      ? error.message
      : "";
  return message || t("wishlist.errors.generic", { ns: "product" });
}

/** True on a store's own subdomain, where the main site's session doesn't exist. */
function onStoreSubdomain() {
  if (typeof window === "undefined") return false;
  return !!getStoreSlugFromHost(window.location.host, hostConfig().rootDomain);
}

/**
 * The heart. Filled = saved. Guests are sent to sign in and the product is
 * saved when they come back. Never navigates the card it sits in.
 */
export function WishlistButton({
  productId,
  title,
  className = "",
}: {
  productId: string;
  title: string;
  className?: string;
}) {
  const { t } = useTranslation("product");
  const router = useRouter();
  const href = useRouterState({ select: (s) => s.location.href });
  const { user, ready } = useAuth();
  const { ids } = useWishlistIds();
  const toggle = useWishlistToggle({
    onError: (error) => toast.error(wishlistErrorMessage(t, error)),
  });
  const saved = ids.includes(productId);

  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    // Inside a card the heart must never follow the card's link.
    e.preventDefault();
    e.stopPropagation();
    if (!ready || toggle.isPending) return;
    if (!user) {
      if (onStoreSubdomain()) {
        // Sign-in lives on the main domain (no session here); come back to this
        // product there, carrying the save in the address.
        window.location.assign(mainSiteSaveSignInUrl(productId));
        return;
      }
      rememberPendingSave(productId);
      void router.navigate({ to: "/login", search: { redirect: href } });
      return;
    }
    toggle.mutate(
      { productId, save: !saved },
      { onSuccess: () => toast.success(t(saved ? "wishlist.removed" : "wishlist.saved")) },
    );
  };

  return (
    <button
      type="button"
      className={`wishlist-heart ${className}`}
      data-saved={saved || undefined}
      // Store templates: an action, so the editor preview leaves it inert.
      data-tpl-action
      aria-pressed={saved}
      aria-label={t(saved ? "wishlist.removeAria" : "wishlist.saveAria", { title })}
      title={t(saved ? "wishlist.removeTitle" : "wishlist.saveTitle")}
      onClick={onClick}
    >
      <Heart aria-hidden fill={saved ? "currentColor" : "none"} />
    </button>
  );
}

/**
 * Mounted once in the root layout: after a guest signs in, saves the product
 * they tapped (from this tab's sessionStorage, or `?saveToWishlist=` when they
 * came from a store subdomain).
 */
export function PendingWishlistSave() {
  const { t } = useTranslation("product");
  const router = useRouter();
  const href = useRouterState({ select: (s) => s.location.href });
  const { user, ready } = useAuth();
  const toggle = useWishlistToggle({
    onError: (error) => toast.error(wishlistErrorMessage(t, error)),
  });
  const { mutate } = toggle;
  const signedIn = ready && !!user;

  useEffect(() => {
    if (!signedIn) return;
    const fromUrl = pendingSaveFromUrl(href);
    if (fromUrl) router.history.replace(withoutSaveParam(href));
    const productId = fromUrl ?? takePendingSave();
    if (!productId) return;
    mutate(
      { productId, save: true },
      { onSuccess: () => toast.success(t("wishlist.savedAfterSignIn")) },
    );
  }, [signedIn, href, router, mutate, t]);

  return null;
}
