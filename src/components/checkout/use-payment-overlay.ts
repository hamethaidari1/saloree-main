import { useCallback, useEffect, useRef, useState } from "react";
import { goToPaymentPage } from "@/lib/pending-payment";
import {
  CLOSED_OVERLAY,
  remainingWait,
  type OverlayState,
  type OverlayStep,
  type OverlayVariant,
} from "@/lib/payment-overlay";

/**
 * State of the "Securing your order" screen. `start` runs in the click itself
 * (React renders a click's update before the browser paints, so the screen
 * covers the page in the same frame) and refuses a second start while open:
 * a double click can never place two orders.
 */
export function usePaymentOverlay({ onPageRestore }: { onPageRestore?: () => void } = {}) {
  const [state, setState] = useState<OverlayState>(CLOSED_OVERLAY);
  const openRef = useRef(false);
  const startedAt = useRef(0);
  const timer = useRef<number | null>(null);
  const restore = useRef(onPageRestore);
  restore.current = onPageRestore;

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const start = useCallback((variant: OverlayVariant) => {
    if (openRef.current) return false;
    openRef.current = true;
    startedAt.current = Date.now();
    setState({ open: true, variant, startedAt: startedAt.current, done: [] });
    return true;
  }, []);

  /** A real call finished. */
  const mark = useCallback((step: OverlayStep) => {
    setState((s) => (s.open && !s.done.includes(step) ? { ...s, done: [...s.done, step] } : s));
  }, []);

  /** On an error: closes at once (no minimum time). */
  const close = useCallback(() => {
    clearTimer();
    openRef.current = false;
    setState(CLOSED_OVERLAY);
  }, []);

  /**
   * Goes to Stripe once the screen has been up for the minimum time, or at
   * once if it already has. The screen stays up while the page unloads.
   */
  const redirect = useCallback(
    (url: string) =>
      new Promise<void>((resolve) => {
        clearTimer();
        const go = () => {
          timer.current = null;
          goToPaymentPage(url);
          resolve();
        };
        const wait = remainingWait(startedAt.current, Date.now());
        if (wait <= 0) go();
        else timer.current = window.setTimeout(go, wait);
      }),
    [],
  );

  // Back from Stripe with the browser's back button: the page may come from
  // the back/forward cache with the screen still up. Reset it.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      close();
      restore.current?.();
    };
    window.addEventListener("pageshow", onShow);
    return () => {
      window.removeEventListener("pageshow", onShow);
      clearTimer();
    };
  }, [close]);

  return { state, start, mark, close, redirect, isOpen: () => openRef.current };
}
export type PaymentOverlayControl = ReturnType<typeof usePaymentOverlay>;
