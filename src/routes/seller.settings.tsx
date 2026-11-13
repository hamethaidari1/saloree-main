import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { storePublicAddress, storeUrl } from "@/lib/host";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/marketplace/auth-form";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { useSeller } from "@/components/seller/seller-context";
import { SellerPageHeader } from "@/components/seller/seller-shell";

export const Route = createFileRoute("/seller/settings")({
  ssr: false,
  pendingComponent: CatalogSkeleton,
  component: SettingsPage,
});

function SettingsPage() {
  const { store, user } = useSeller();
  const published = store.status === "published";
  const address = storePublicAddress(store.slug) ?? storeUrl(store.slug);
  const [copied, setCopied] = useState(false);
  return (
    <div className="seller-page">
      <SellerPageHeader title="Settings" />
      <div className="grid max-w-3xl gap-4">
        <section className="seller-card" aria-labelledby="set-status">
          <h2 id="set-status" className="mb-2 flex items-center gap-2 text-base font-semibold">
            Store status
            <Badge variant={published ? "default" : "secondary"}>{store.status}</Badge>
          </h2>
          <p className="text-sm text-muted-foreground">
            {published
              ? "Your store is live. Shoppers can find it and buy your active products."
              : "Your store is a draft and hidden from shoppers. A Saloree admin reviews and publishes stores — you'll see the status change here when that happens."}
          </p>
        </section>

        <section className="seller-card" aria-labelledby="set-url">
          <h2 id="set-url" className="mb-2 text-base font-semibold">
            Store address
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all text-sm">{address}</code>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(address);
                  setCopied(true);
                  toast.success("Store address copied");
                } catch {
                  toast.error("Couldn't copy. Select the address and copy it manually.");
                }
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
          {published ? (
            <Button asChild variant="outline" size="sm" className="mt-3">
              <a href={storeUrl(store.slug)}>
                View my store <ExternalLink />
              </a>
            </Button>
          ) : (
            <p className="seller-hint mt-2">
              This address starts working once the store is published.
            </p>
          )}
          <p className="seller-hint mt-2">
            You can change the address on the{" "}
            <Link to="/seller/content" className="text-primary underline-offset-2 hover:underline">
              Content
            </Link>{" "}
            page.
          </p>
        </section>

        <section className="seller-card" aria-labelledby="set-info">
          <h2 id="set-info" className="mb-2 text-base font-semibold">
            Store information
          </h2>
          <dl className="grid gap-1 text-sm">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Name:</dt>
              <dd>{store.name}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Created:</dt>
              <dd>{new Date(store.created_at).toLocaleDateString()}</dd>
            </div>
          </dl>
          <Button asChild variant="outline" size="sm" className="mt-3">
            <Link to="/seller/content">Edit store page</Link>
          </Button>
        </section>

        <section className="seller-card" aria-labelledby="set-account">
          <h2 id="set-account" className="mb-2 text-base font-semibold">
            Account
          </h2>
          <p className="text-sm">{user.email}</p>
          <div className="mt-3">
            <SignOutButton />
          </div>
        </section>
      </div>
    </div>
  );
}
