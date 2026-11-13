import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import type { User } from "@supabase/supabase-js";
import { ChevronDown, ChevronRight, LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { signOut, useAuth } from "@/lib/auth";

/**
 * "Sara" from "Sara Ahmadi": profiles.full_name first, then the sign-up
 * metadata, else the email's local part.
 */
export function firstName(
  user: Pick<User, "email" | "user_metadata"> | null,
  profileName?: string | null,
) {
  const full = (profileName ?? String(user?.user_metadata?.["full_name"] ?? "")).trim();
  if (full) return full.split(/\s+/)[0] ?? full;
  return user?.email?.split("@")[0] ?? "";
}

/** Account links; shared by the header dropdown and the mobile drawer. */
export function AccountMenuPanel({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation("nav");
  const { user, ready, isSeller, isAdmin } = useAuth();
  const navigate = useNavigate();

  if (!ready)
    return (
      <div aria-busy="true" aria-label={t("account.loading")}>
        <div className="nav-skeleton" />
        <div className="nav-skeleton w-2/3" />
      </div>
    );

  if (!user)
    return (
      <div className="grid gap-2 text-center">
        <Button asChild className="w-full">
          <Link to="/login" onClick={onNavigate}>
            {t("account.signIn")}
          </Link>
        </Button>
        <p className="text-xs text-muted-foreground">
          {t("account.newCustomer")}{" "}
          <Link
            to="/register"
            onClick={onNavigate}
            className="font-semibold text-primary underline-offset-2 hover:underline"
          >
            {t("account.startHere")}
          </Link>
        </p>
      </div>
    );

  return (
    <nav aria-label={t("account.title")}>
      <ul className="grid gap-0.5">
        <li>
          <Link to="/account" hash="my-orders" className="nav-panel-link" onClick={onNavigate}>
            {t("account.myOrders")}
          </Link>
        </li>
        <li>
          <span className="nav-panel-link" aria-disabled="true">
            {t("account.wishlist")} <span className="nav-soon">{t("account.comingSoon")}</span>
          </span>
        </li>
        <li>
          <Link to="/account" className="nav-panel-link" onClick={onNavigate}>
            {t("account.account")}
          </Link>
        </li>
        {isSeller && (
          <li>
            <Link to="/seller" className="nav-panel-link" onClick={onNavigate}>
              {t("account.myStore")}
            </Link>
          </li>
        )}
        {isAdmin && (
          <li>
            <Link to="/admin" className="nav-panel-link" onClick={onNavigate}>
              {t("account.admin")}
            </Link>
          </li>
        )}
        <li className="mt-1 border-t pt-1">
          <button
            type="button"
            className="nav-panel-link"
            onClick={async () => {
              try {
                await signOut();
                onNavigate?.();
                await navigate({ to: "/" });
              } catch {
                toast.error(t("account.signOutFailed"));
              }
            }}
          >
            {t("account.signOut")}
            <LogOut size={15} aria-hidden className="rtl:-scale-x-100" />
          </button>
        </li>
      </ul>
    </nav>
  );
}

/** Small screens: "Sign in ›" / "Sara ›" next to a person icon. */
export function MobileAccountLink() {
  const { t } = useTranslation("nav");
  const { user, ready, fullName } = useAuth();
  const name = user ? firstName(user, fullName) : "";
  return (
    <Link
      to={user ? "/account" : "/login"}
      className="nav-hit"
      aria-label={
        !ready
          ? t("account.account")
          : user
            ? t("account.mobileAria", { name })
            : t("account.signIn")
      }
    >
      {ready && (
        <span className="flex max-w-28 items-center text-sm">
          <span className="truncate">{user ? name : t("account.signIn")}</span>
          <ChevronRight size={14} aria-hidden className="shrink-0 rtl:-scale-x-100" />
        </span>
      )}
      <UserRound size={26} aria-hidden className="shrink-0" />
    </Link>
  );
}

/** "Hello, …" block in the header; opens on hover (mouse) or click/keyboard. */
export function AccountMenu() {
  const { t } = useTranslation("nav");
  const { user, ready, fullName } = useAuth();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const openedByHover = useRef(false);
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const hoverOpen = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    clearTimeout(closeTimer.current);
    if (!open) openedByHover.current = true;
    setOpen(true);
  };
  const hoverClose = (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse") return;
    closeTimer.current = setTimeout(() => close(), 150);
  };
  const close = () => {
    openedByHover.current = false;
    setOpen(false);
  };

  const greeting = !ready
    ? t("greeting.loading")
    : user
      ? t("greeting.user", { name: firstName(user, fullName) })
      : t("greeting.guest");
  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <PopoverTrigger
        className="nav-hit"
        onPointerEnter={hoverOpen}
        onPointerLeave={hoverClose}
        onClick={(e) => {
          // A click right after hover-open keeps it open instead of toggling it shut.
          e.preventDefault();
          setOpen((o) => (openedByHover.current ? true : !o));
          openedByHover.current = false;
        }}
      >
        <span className="text-start">
          <span className="nav-small">{greeting}</span>
          <span className="nav-strong flex items-center gap-1">
            {t("accountAndLists")} <ChevronDown size={14} aria-hidden />
          </span>
        </span>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 p-3"
        onPointerEnter={hoverOpen}
        onPointerLeave={hoverClose}
      >
        <h2 className="mb-2 px-2 text-sm font-semibold">
          {user ? t("account.title") : t("account.welcome")}
        </h2>
        <AccountMenuPanel onNavigate={close} />
      </PopoverContent>
    </Popover>
  );
}
