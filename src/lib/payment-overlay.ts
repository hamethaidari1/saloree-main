/**
 * The "Securing your order" screen shown on the way to Stripe: its timing
 * rules (pure, so they are tested without a browser).
 *
 * - It stays at least MIN_OVERLAY_MS from the click, so it never flashes.
 * - It adds nothing beyond that: if the real calls take longer, the redirect
 *   happens as soon as Stripe's address is ready.
 * - An error never waits: the screen closes at once.
 */
export const PAYMENT_OVERLAY = { minMs: 3000 };

/** How long to wait before redirecting, given when the screen opened. */
export function remainingWait(startedAt: number, now: number, minMs = PAYMENT_OVERLAY.minMs) {
  return Math.max(0, minMs - Math.max(0, now - startedAt));
}

/**
 * The steps as the real flow completes them. Placing the order also reserves
 * the stock (place_order does both), so those two finish together; Stripe is
 * done when create-checkout-session returned the address.
 */
export type OverlayStep = "placed" | "connected";
export type OverlayVariant = "checkout" | "retry";

export interface OverlayState {
  open: boolean;
  variant: OverlayVariant;
  startedAt: number;
  done: readonly OverlayStep[];
}

export const CLOSED_OVERLAY: OverlayState = {
  open: false,
  variant: "checkout",
  startedAt: 0,
  done: [],
};

/** The lines shown, in order, each with whether its real call finished. */
export function overlaySteps(state: OverlayState) {
  const placed = state.done.includes("placed");
  const connected = state.done.includes("connected");
  return state.variant === "retry"
    ? [{ id: "connect", done: connected }]
    : [
        { id: "place", done: placed },
        { id: "reserve", done: placed },
        { id: "connect", done: connected },
      ];
}
