import { createFileRoute } from "@tanstack/react-router";
import { useSeller } from "@/components/seller/seller-context";
import { SellerPageHeader } from "@/components/seller/seller-shell";
import { VerificationPage } from "@/components/seller/verification/status";

export const Route = createFileRoute("/seller/verification")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Verification — Saloree" }, { name: "robots", content: "noindex" }],
  }),
  component: SellerVerificationPage,
});

function SellerVerificationPage() {
  const { user, categories } = useSeller();
  return (
    <div className="seller-page">
      <SellerPageHeader
        title="Seller verification"
        description="Who is selling: required by law before your store can be published."
      />
      <VerificationPage userId={user.id} categories={categories.map((c) => c.name)} />
    </div>
  );
}
