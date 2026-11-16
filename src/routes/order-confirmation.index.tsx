import { useTranslation } from "react-i18next";
import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { headT } from "@/i18n/head";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { useCart } from "@/components/marketplace/cart-context";
import {
  ConfirmationLinks,
  ConfirmationNotFound,
  OrderConfirmation,
} from "@/components/marketplace/order-confirmation";
import { requireAuth } from "@/lib/auth";
import { clearPendingPayment, readPendingPayment } from "@/lib/pending-payment";
import { cardPaymentService, waitForPayment } from "@/services/card-payment";

/**
 * Where Stripe sends the customer after paying: /order-confirmation?group=<id>.
 * The webhook marks the orders paid a moment later; this page only reads the
 * orders until they are. Stripe's session_id in the address is not used.
 */
export const Route = createFileRoute("/order-confirmation/")({
  ssr: false,
  validateSearch: (s: Record<string, unknown>): { group: string } => ({
    group: typeof s["group"] === "string" ? s["group"] : "",
  }),
  beforeLoad: requireAuth(),
  head: ({ matches }) => ({
    meta: [
      { title: headT(matches, "orders")("confirmation.metaTitle") },
      { name: "robots", content: "noindex" },
    ],
  }),
  pendingComponent: CatalogSkeleton,
  component: PaymentReturnPage,
});

type Phase = "confirming" | "paid" | "failed" | "none" | "timeout";

function PaymentReturnPage() {
  const { group } = Route.useSearch();
  return group ? <PaymentReturn key={group} groupId={group} /> : <ConfirmationNotFound />;
}

function PaymentReturn({ groupId }: { groupId: string }) {
  const { t } = useTranslation("orders");
  const queryClient = useQueryClient();
  const { clear } = useCart();
  const [phase, setPhase] = useState<Phase>("confirming");
  const clearRef = useRef(clear);
  clearRef.current = clear;

  useEffect(() => {
    const ctrl = new AbortController();
    void waitForPayment(() => cardPaymentService.groupPayment(groupId), {
      signal: ctrl.signal,
    }).then(async (result) => {
      if (result === "aborted" || ctrl.signal.aborted) return;
      if (result === "paid") {
        // This tab started the payment: the bag was ordered, so empty it
        // (unless it was a "Buy now" of one item: then the bag was never ordered).
        const started = readPendingPayment();
        if (started?.groupId === groupId && !started.express) clearRef.current();
        clearPendingPayment(groupId);
        await queryClient.invalidateQueries({ queryKey: ["checkout", groupId] });
        // (The catalog is fresh: coming back from Stripe is a full page load.)
        void queryClient.invalidateQueries({ queryKey: ["orders"] });
      }
      if (result === "failed") clearPendingPayment(groupId);
      if (!ctrl.signal.aborted) setPhase(result);
    });
    return () => ctrl.abort();
  }, [groupId, queryClient]);

  if (phase === "paid") return <OrderConfirmation groupId={groupId} />;
  if (phase === "none") return <ConfirmationNotFound />;
  return (
    <main className="market-container auth-page">
      <section className="auth-card confirmation text-center" aria-labelledby="pay-heading">
        {phase === "confirming" && (
          <>
            <Loader2 className="mx-auto animate-spin text-primary" size={36} aria-hidden />
            <h1 id="pay-heading" className="page-title" role="status">
              {t("payment.confirming")}
            </h1>
          </>
        )}
        {phase === "timeout" && (
          <>
            <h1 id="pay-heading" className="page-title">
              {t("payment.stillConfirmingTitle")}
            </h1>
            <p className="page-subtitle" role="status">
              {t("payment.stillConfirming")}
            </p>
            <ConfirmationLinks />
          </>
        )}
        {phase === "failed" && (
          <>
            <h1 id="pay-heading" className="page-title">
              {t("payment.notCompleted")}
            </h1>
            <p className="page-subtitle" role="alert">
              {t("payment.notCompletedText")}
            </p>
            <div className="mt-6 flex justify-center">
              <Button asChild>
                <Link to="/cart">{t("payment.backToBag")}</Link>
              </Button>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
