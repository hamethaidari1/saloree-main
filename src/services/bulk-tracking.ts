/**
 * "Add tracking numbers" (seller Orders): which orders can still ship, the
 * per-row checks, the paste helper, and saving rows one by one through the
 * same `shippingService.add` the single-order form uses (each row becomes an
 * "In transit" shipment; the database still applies every shipping rule).
 */
import { z } from "zod";
import type { OrderRow } from "@/data/db";
import { shippingError, shippingService } from "./shipping";

// ---------------------------------------------------------------------------
// Which orders can still ship
// ---------------------------------------------------------------------------
/** Order statuses a shipment may be added to (the database refuses cancelled / delivered). */
export const SHIPPABLE_STATUSES = ["pending", "processing", "shipped"] as const;

/** Online payments must be paid first; pay-on-delivery (cod) can ship unpaid. */
export const isPaidOrCod = (o: Pick<OrderRow, "payment_provider" | "payment_status">) =>
  (o.payment_provider ?? "cod") === "cod" || o.payment_status === "paid";

/**
 * Orders that can get their first tracking number: a status that can ship,
 * paid if paid online, and no shipment yet.
 */
export function shippableOrders<
  T extends Pick<OrderRow, "id" | "status" | "payment_provider" | "payment_status">,
>(orders: T[], ordersWithShipment: ReadonlySet<string>): T[] {
  return orders.filter(
    (o) =>
      (SHIPPABLE_STATUSES as readonly string[]).includes(o.status) &&
      isPaidOrCod(o) &&
      !ordersWithShipment.has(o.id),
  );
}

export const shortOrderId = (id: string) => id.slice(0, 8);

// ---------------------------------------------------------------------------
// Row checks
// ---------------------------------------------------------------------------
export const TRACKING_MIN = 5;
export const TRACKING_MAX = 40;

/**
 * Typed value → the number that is saved (spaces removed). 5–40 characters of
 * letters, digits and dashes, starting and ending with a letter or digit (the
 * database's rule for tracking numbers).
 */
export const bulkTrackingNumberSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9 -]*$/, "Use only letters, numbers, dashes and spaces.")
  .transform((v) => v.replace(/\s+/g, ""))
  .pipe(
    z
      .string()
      .min(TRACKING_MIN, `Use at least ${TRACKING_MIN} characters (spaces don't count).`)
      .max(TRACKING_MAX, `Use at most ${TRACKING_MAX} characters.`)
      .regex(/^[A-Za-z0-9](?:.*[A-Za-z0-9])?$/, "Start and end with a letter or number."),
  );

export interface DraftRow {
  orderId: string;
  carrierId: string;
  tracking: string;
}
export interface RowErrors {
  carrier?: string;
  tracking?: string;
}
export interface ReadyRow {
  orderId: string;
  carrierId: string;
  trackingNumber: string;
}

/** Same number regardless of spaces and letter case. */
const dupKey = (v: string) => v.replace(/\s+/g, "").toUpperCase();

/**
 * Checks the filled rows (rows with an empty tracking number are skipped).
 * Returns the rows ready to save and the problems per order id.
 */
export function validateRows(
  rows: DraftRow[],
  activeCarrierIds: ReadonlySet<string>,
): { ready: ReadyRow[]; errors: Record<string, RowErrors>; filled: number } {
  const filled = rows.filter((r) => r.tracking.trim() !== "");
  const counts = new Map<string, number>();
  for (const r of filled) counts.set(dupKey(r.tracking), (counts.get(dupKey(r.tracking)) ?? 0) + 1);

  const ready: ReadyRow[] = [];
  const errors: Record<string, RowErrors> = {};
  for (const r of filled) {
    const e: RowErrors = {};
    const parsed = bulkTrackingNumberSchema.safeParse(r.tracking);
    if (!parsed.success) e.tracking = parsed.error.issues[0]?.message ?? "Check this number.";
    else if ((counts.get(dupKey(r.tracking)) ?? 0) > 1)
      e.tracking = "This tracking number is used more than once in this list.";
    if (!r.carrierId) e.carrier = "Choose a carrier.";
    else if (!activeCarrierIds.has(r.carrierId))
      e.carrier = "That carrier isn't available any more.";
    if (e.carrier || e.tracking) errors[r.orderId] = e;
    else if (parsed.success)
      ready.push({ orderId: r.orderId, carrierId: r.carrierId, trackingNumber: parsed.data });
  }
  return { ready, errors, filled: filled.length };
}

/** "Same carrier for all rows": fills only the rows without a carrier. */
export function fillEmptyCarriers(rows: DraftRow[], carrierId: string): DraftRow[] {
  return rows.map((r) => (r.carrierId ? r : { ...r, carrierId }));
}

// ---------------------------------------------------------------------------
// Paste "one per line"
// ---------------------------------------------------------------------------
export const parsePastedNumbers = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

export interface PastePlan {
  assignments: { orderId: string; tracking: string }[];
  /** Pasted numbers that did not fit (no empty row left for them). */
  leftover: string[];
}

/** Pasted numbers → the empty tracking cells, in the order the rows are shown. Nothing is applied. */
export function planPasteFill(rowsInOrder: DraftRow[], pasted: string[]): PastePlan {
  const empty = rowsInOrder.filter((r) => r.tracking.trim() === "");
  const n = Math.min(empty.length, pasted.length);
  return {
    assignments: empty.slice(0, n).map((r, i) => ({ orderId: r.orderId, tracking: pasted[i]! })),
    leftover: pasted.slice(n),
  };
}

export function applyPasteFill(rows: DraftRow[], plan: PastePlan): DraftRow[] {
  const byOrder = new Map(plan.assignments.map((a) => [a.orderId, a.tracking]));
  return rows.map((r) =>
    byOrder.has(r.orderId) && r.tracking.trim() === ""
      ? { ...r, tracking: byOrder.get(r.orderId)! }
      : r,
  );
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------
export type SaveResult =
  { orderId: string; ok: true } | { orderId: string; ok: false; error: string };

/**
 * Saves rows one by one (one failure never blocks the rest) and reports each
 * row's real outcome. Each row is an "In transit" shipment, as before.
 */
export async function saveTrackingRows(
  rows: ReadyRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<SaveResult[]> {
  const results: SaveResult[] = [];
  for (const [i, r] of rows.entries()) {
    try {
      await shippingService.add(r.orderId, {
        carrier_id: r.carrierId,
        carrier_name: null,
        tracking_number: r.trackingNumber,
        tracking_url: null,
        status: "in_transit",
      });
      results.push({ orderId: r.orderId, ok: true });
    } catch (e) {
      results.push({ orderId: r.orderId, ok: false, error: shippingError(e) });
    }
    onProgress?.(i + 1, rows.length);
  }
  return results;
}
