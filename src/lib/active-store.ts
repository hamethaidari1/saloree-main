/**
 * The seller area works on ONE store at a time: the "active store". Only its
 * id is remembered in this browser (localStorage), and it is always checked
 * against the stores the signed-in person really owns, so an id left by
 * someone else on a shared computer is ignored. Cleared on sign-out.
 */
export const ACTIVE_STORE_KEY = "saloree-seller-store";

export function readActiveStoreId(): string | null {
  try {
    const v = window.localStorage.getItem(ACTIVE_STORE_KEY);
    return v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeActiveStoreId(id: string) {
  try {
    window.localStorage.setItem(ACTIVE_STORE_KEY, id);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
}

export function clearActiveStoreId() {
  try {
    window.localStorage.removeItem(ACTIVE_STORE_KEY);
  } catch {
    /* ignore */
  }
}

/** The remembered store if it is one of `mine`, else the first of `mine`, else null. */
export function resolveActiveStore<T extends { id: string }>(
  mine: readonly T[],
  remembered: string | null,
): T | null {
  return mine.find((s) => s.id === remembered) ?? mine[0] ?? null;
}

/** Whether this person already accepted this Seller Agreement version on another store. */
export function agreementAccepted(
  stores: readonly { seller_agreement_version?: string | null }[],
  version: string | null | undefined,
): boolean {
  return !!version && stores.some((s) => s.seller_agreement_version === version);
}
