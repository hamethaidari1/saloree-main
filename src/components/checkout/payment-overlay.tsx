import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, Lock } from "lucide-react";
import { Logo } from "@/components/marketplace/logo";
import { overlaySteps, type OverlayState } from "@/lib/payment-overlay";
import { footerQuery, type FooterContent } from "@/services/site";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** While open: the rest of the page can't be reached, read or scrolled. */
function useModalBackground(open: boolean, root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const others = [...document.body.children].filter(
      (el): el is HTMLElement => el instanceof HTMLElement && !el.contains(root.current),
    );
    const before = others.map(
      (el) => [el.hasAttribute("inert"), el.getAttribute("aria-hidden")] as const,
    );
    for (const el of others) {
      el.setAttribute("inert", "");
      el.setAttribute("aria-hidden", "true");
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    root.current?.focus();
    return () => {
      others.forEach((el, i) => {
        const [wasInert, hidden] = before[i]!;
        if (!wasInert) el.removeAttribute("inert");
        if (hidden === null) el.removeAttribute("aria-hidden");
        else el.setAttribute("aria-hidden", hidden);
      });
      document.body.style.overflow = overflow;
    };
  }, [open, root]);
}

/**
 * The full-screen "Securing your order" screen on the way to Stripe. Every
 * line turns into a check only when its real call finished; nothing here is
 * simulated.
 */
export function PaymentOverlay({ state }: { state: OverlayState }) {
  const { t } = useTranslation("checkout");
  const { t: tFooter } = useTranslation("footer");
  const qc = useQueryClient();
  const root = useRef<HTMLDivElement>(null);
  const [reduced] = useState(prefersReducedMotion);
  useModalBackground(state.open, root);
  if (!state.open || typeof document === "undefined") return null;

  // The company line only when its details are filled (already loaded by the footer; no request here).
  const company = qc.getQueryData<FooterContent>(footerQuery.queryKey)?.company;
  const companyLine = [company?.legalName, company?.businessId].filter(Boolean).join(" · ");
  const steps = overlaySteps(state);
  const connected = state.done.includes("connected");
  const placed = state.done.includes("placed");
  const live =
    state.variant === "retry"
      ? connected
        ? t("overlay.liveConnected")
        : t("overlay.liveConnecting")
      : connected
        ? t("overlay.liveConnected")
        : placed
          ? t("overlay.livePlaced")
          : t("overlay.livePlacing");
  const title = state.variant === "retry" ? t("overlay.titleRetry") : t("overlay.title");

  return createPortal(
    <div
      ref={root}
      className="pay-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pay-overlay-title"
      aria-describedby="pay-overlay-text"
      tabIndex={-1}
      data-reduced-motion={reduced || undefined}
      data-testid="payment-overlay"
    >
      <div className="pay-overlay-card">
        <div className="pay-overlay-logo">
          <Logo onDark />
        </div>
        <div className="pay-overlay-bar" role="progressbar" aria-label={title}>
          <span />
        </div>
        <h2 id="pay-overlay-title">{title}</h2>
        <p id="pay-overlay-text">{t("overlay.text")}</p>
        <ol className="pay-overlay-steps">
          {steps.map((s) => (
            <li key={s.id} data-done={s.done || undefined}>
              <span className="pay-overlay-mark" aria-hidden>
                {s.done ? <Check size={14} /> : <span className="pay-overlay-dot" />}
              </span>
              <span>{t(`overlay.step.${s.id}`)}</span>
              <span className="sr-only">
                {s.done ? t("overlay.stepDone") : t("overlay.stepWorking")}
              </span>
            </li>
          ))}
        </ol>
        <p className="sr-only" aria-live="polite" data-testid="payment-overlay-live">
          {live}
        </p>
        <footer className="pay-overlay-foot">
          <p>
            <Lock size={14} aria-hidden />
            <span>{tFooter("stripeNote")}</span>
          </p>
          {companyLine && <p dir="auto">{companyLine}</p>}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
