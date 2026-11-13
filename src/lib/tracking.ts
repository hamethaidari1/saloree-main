/**
 * Shipment tracking logic that does not care where the data comes from:
 * seller updates today, an automatic tracking provider (17TRACK / Ship24 via
 * an Edge Function writing `shipment_events` with source "provider") later.
 * Pure functions only — no database access — so they are easy to test.
 */
import type { CarrierRow, ShipmentEventRow, ShipmentRow, ShipmentStatus } from "@/data/db";

export const SHIPMENT_STATUSES = [
  "label_created",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "exception",
  "returned",
] as const satisfies readonly ShipmentStatus[];

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  label_created: "Label created",
  in_transit: "In transit",
  out_for_delivery: "Out for delivery",
  delivered: "Delivered",
  exception: "Delivery problem",
  returned: "Returned",
};

export const statusLabel = (status: string) =>
  SHIPMENT_STATUS_LABELS[status as ShipmentStatus] ?? status.replace(/_/g, " ");

export const isShipmentStatus = (s: unknown): s is ShipmentStatus =>
  SHIPMENT_STATUSES.includes(s as ShipmentStatus);

/** Placeholder in a carrier's tracking_url_template. */
export const TRACKING_NUMBER_PLACEHOLDER = "{number}";

/**
 * Returns the URL only if it is a well-formed https:// URL — never
 * `javascript:`, `data:`, `http:` or relative links.
 */
export function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^https:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "https:" && url.hostname ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Fills a carrier template; the number is URL-encoded. Result must be https. */
export function fillTrackingTemplate(template: string | null | undefined, number: string) {
  if (!template || !template.includes(TRACKING_NUMBER_PLACEHOLDER)) return null;
  return safeHttpsUrl(
    template.split(TRACKING_NUMBER_PLACEHOLDER).join(encodeURIComponent(number.trim())),
  );
}

/** The shipment's own link if it has one, else the carrier's template. Always https or null. */
export function buildTrackingUrl(
  shipment: Pick<ShipmentRow, "tracking_url" | "tracking_number">,
  carrier?: Pick<CarrierRow, "tracking_url_template"> | null,
) {
  return (
    safeHttpsUrl(shipment.tracking_url) ??
    fillTrackingTemplate(carrier?.tracking_url_template, shipment.tracking_number)
  );
}

/** Newest first; stable for equal times. */
export function sortEvents<T extends Pick<ShipmentEventRow, "occurred_at">>(events: T[]) {
  return events
    .map((e, i) => ({ e, i, t: Date.parse(e.occurred_at) || 0 }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map((x) => x.e);
}

// ---------------------------------------------------------------------------
// Customer progress bar
// ---------------------------------------------------------------------------
export const PROGRESS_STEPS = [
  { key: "placed", label: "Order placed" },
  { key: "processing", label: "Processing" },
  { key: "shipped", label: "Shipped" },
  { key: "out_for_delivery", label: "Out for delivery" },
  { key: "delivered", label: "Delivered" },
] as const;
export type ProgressKey = (typeof PROGRESS_STEPS)[number]["key"];

const SHIPMENT_STEP: Record<string, number> = {
  label_created: 1,
  in_transit: 2,
  out_for_delivery: 3,
  delivered: 4,
};
const ORDER_STEP: Record<string, number> = {
  pending: 0,
  processing: 1,
  shipped: 2,
  delivered: 4,
};

export interface Progress {
  steps: { key: ProgressKey; label: string; state: "done" | "current" | "upcoming" }[];
  current: ProgressKey;
  /** Shown prominently next to the bar. */
  alert: "exception" | "returned" | "cancelled" | null;
}

/**
 * Where an order is, from the real order status and its shipments. With
 * several shipments the order only reaches a step once all shipments have
 * (the least advanced one counts); the order's own status (kept in sync by
 * the database) can move it further.
 */
export function trackingProgress(
  orderStatus: string,
  shipments: Pick<ShipmentRow, "status">[],
): Progress {
  const tracked = shipments.filter((s) => s.status in SHIPMENT_STEP);
  const fromShipments = tracked.length
    ? Math.min(...tracked.map((s) => SHIPMENT_STEP[s.status] ?? 0))
    : 0;
  const index = Math.max(ORDER_STEP[orderStatus] ?? 0, fromShipments);
  const alert =
    orderStatus === "cancelled"
      ? "cancelled"
      : shipments.some((s) => s.status === "returned")
        ? "returned"
        : shipments.some((s) => s.status === "exception")
          ? "exception"
          : null;
  const steps = PROGRESS_STEPS.map((s, i) => ({
    ...s,
    state:
      i < index || (i === index && s.key === "delivered")
        ? ("done" as const)
        : i === index
          ? ("current" as const)
          : ("upcoming" as const),
  }));
  return { steps, current: PROGRESS_STEPS[index]?.key ?? "placed", alert };
}
