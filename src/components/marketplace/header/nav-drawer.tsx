import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, CircleUserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";
import { catalogQuery } from "@/services/catalog";
import { AccountMenuPanel, firstName } from "./account-menu";
import { LanguageSelect } from "./language-select";
import { NavLinkItems, SellLink } from "./nav-links";

function CategoryLinks({ onNavigate }: { onNavigate: () => void }) {
  const catalog = useQuery(catalogQuery);
  if (catalog.isPending)
    return (
      <div aria-busy="true" aria-label="Loading categories">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="nav-skeleton" />
        ))}
      </div>
    );
  if (catalog.isError)
    return (
      <div role="alert" className="px-1 text-sm">
        <p className="mb-2 text-muted-foreground">Categories couldn't be loaded.</p>
        <Button size="sm" variant="outline" onClick={() => catalog.refetch()}>
          Try again
        </Button>
      </div>
    );
  if (!catalog.data.categories.length)
    return <p className="px-1 text-sm text-muted-foreground">No categories yet.</p>;
  return (
    <ul>
      {catalog.data.categories.map((c) => (
        <li key={c.slug}>
          <Link
            to="/category/$slug"
            params={{ slug: c.slug }}
            className="nav-drawer-link"
            onClick={onNavigate}
          >
            {c.name}
            <ChevronRight size={16} aria-hidden className="rtl:-scale-x-100" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Side drawer: categories + shortcuts; on mobile also account and language. */
export function NavDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { user, ready } = useAuth();
  const close = () => onOpenChange(false);
  const greeting = !ready ? "Hello" : user ? `Hello, ${firstName(user)}` : "Hello, sign in";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-[85vw] max-w-sm gap-0 overflow-y-auto p-0 [&>button:first-of-type]:text-nav-foreground [&>button:first-of-type]:opacity-100"
      >
        <SheetHeader className="bg-nav px-5 py-4 pe-12 text-start text-nav-foreground">
          <SheetTitle className="flex items-center gap-2 text-lg text-nav-foreground">
            <CircleUserRound size={22} aria-hidden />
            {greeting}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Browse categories and Saloree shortcuts.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4">
          {/* Mobile only: these live in the header row on large screens. */}
          <section className="nav-drawer-section lg:hidden" aria-labelledby="drawer-account">
            <h3 id="drawer-account">Account &amp; Lists</h3>
            <AccountMenuPanel onNavigate={close} />
          </section>

          <section className="nav-drawer-section" aria-labelledby="drawer-categories">
            <h3 id="drawer-categories">Shop by category</h3>
            <CategoryLinks onNavigate={close} />
          </section>

          <section className="nav-drawer-section" aria-labelledby="drawer-explore">
            <h3 id="drawer-explore">Explore Saloree</h3>
            <div className="grid">
              <NavLinkItems className="nav-drawer-link" onNavigate={close} />
              <SellLink className="nav-drawer-link font-semibold text-primary" onNavigate={close} />
            </div>
          </section>

          <section className="nav-drawer-section border-0 lg:hidden" aria-labelledby="drawer-lang">
            <h3 id="drawer-lang">Language</h3>
            <LanguageSelect tone="light" />
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
