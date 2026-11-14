// Remembers, in this browser tab, the checkout whose card payment was started,
// so /checkout can offer "Try payment again" when Stripe sends the customer
// back. Only the checkout id is stored (no amounts, no card or Stripe data);
// whether it can still be paid is always asked from the server.

const KEY = "saloree.card-payment";
/** Orders stay reserved for about 30 minutes; older records are ignored. */
const MAX_AGE_MS = 35 * 60 * 1000;

export interface PendingPayment {
  groupId: string;
  at: number;
}

export function readPendingPayment(now = Date.now()): PendingPayment | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PendingPayment> | null;
    if (typeof v?.groupId !== "string" || !v.groupId || typeof v.at !== "number") return null;
    if (now - v.at > MAX_AGE_MS) {
      window.sessionStorage.removeItem(KEY);
      return null;
    }
    return { groupId: v.groupId, at: v.at };
  } catch {
    return null;
  }
}

export function savePendingPayment(groupId: string, now = Date.now()) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ groupId, at: now }));
  } catch {
    // Storage blocked: the order is still in My orders with "Pay now".
  }
}

export function clearPendingPayment(groupId?: string) {
  try {
    if (groupId && readPendingPayment()?.groupId !== groupId) return;
    window.sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Leaves the app for Stripe's hosted page (separate so tests can replace it). */
export function goToPaymentPage(url: string) {
  window.location.assign(url);
}
