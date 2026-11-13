import { useTranslation } from "react-i18next";
import { AlertTriangle, Check, ExternalLink, Truck, Undo2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CarrierRow, ShipmentEventRow, ShipmentRow } from "@/data/db";
import { buildTrackingUrl, statusLabel, trackingProgress } from "@/lib/tracking";
import { useFormat } from "@/i18n/hooks";

/** Shipment status in the active language (unknown statuses as before). */
function useShipmentStatusLabel() {
  const { t } = useTranslation("orders");
  return (status: string) =>
    t(`tracking.shipmentStatus.${status}`, { defaultValue: statusLabel(status) });
}

export function ShipmentStatusBadge({ status }: { status: string }) {
  const shipmentStatus = useShipmentStatusLabel();
  const variant =
    status === "delivered"
      ? "default"
      : status === "exception" || status === "returned"
        ? "destructive"
        : "secondary";
  return <Badge variant={variant}>{shipmentStatus(status)}</Badge>;
}

/**
 * "Track" link to the carrier. Renders nothing unless the final URL is
 * https:// — never a `javascript:` or other unsafe link.
 */
export function TrackLink({
  shipment,
  carrier,
  label,
  className,
}: {
  shipment: Pick<ShipmentRow, "tracking_url" | "tracking_number">;
  carrier?: Pick<CarrierRow, "tracking_url_template"> | null;
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation("orders");
  const href = buildTrackingUrl(shipment, carrier);
  if (!href) return null;
  return (
    <Button asChild variant="outline" size="sm" className={className}>
      <a href={href} target="_blank" rel="noopener noreferrer">
        {label ?? t("tracking.track")}
        <ExternalLink aria-hidden className="rtl:-scale-x-100" />
        <span className="sr-only"> {t("tracking.newTab")}</span>
      </a>
    </Button>
  );
}

/** Event list, newest first. Works the same for seller and provider events. */
export function ShipmentTimeline({ events }: { events: ShipmentEventRow[] }) {
  const { t } = useTranslation("orders");
  const format = useFormat();
  const shipmentStatus = useShipmentStatusLabel();
  if (!events.length) return <p className="seller-hint">{t("tracking.noUpdates")}</p>;
  return (
    <ol className="tracking-timeline">
      {events.map((e) => (
        <li key={e.id} data-status={e.status}>
          <span className="tracking-dot" aria-hidden />
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <strong>{shipmentStatus(e.status)}</strong>
              <time dateTime={e.occurred_at} className="text-xs text-muted-foreground">
                {format.dateTime(e.occurred_at) || e.occurred_at}
              </time>
              {e.source === "provider" && (
                <span className="text-xs text-muted-foreground">
                  · {t("tracking.carrierUpdate")}
                </span>
              )}
            </p>
            {e.description && (
              <p className="text-sm" dir="auto">
                {e.description}
              </p>
            )}
            {e.location && (
              <p className="text-xs text-muted-foreground" dir="auto">
                {e.location}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

const ALERT_ICONS = { exception: AlertTriangle, returned: Undo2, cancelled: XCircle } as const;

/** Order placed → Processing → Shipped → Out for delivery → Delivered. */
export function OrderProgress({
  orderStatus,
  shipments,
}: {
  orderStatus: string;
  shipments: Pick<ShipmentRow, "status">[];
}) {
  const { t } = useTranslation("orders");
  const p = trackingProgress(orderStatus, shipments);
  const AlertIcon = p.alert ? ALERT_ICONS[p.alert] : null;
  return (
    <div className="grid gap-3">
      {p.alert !== "cancelled" && (
        <ol className="tracking-progress" aria-label={t("tracking.progressLabel")}>
          {p.steps.map((s) => (
            <li
              key={s.key}
              data-state={s.state}
              aria-current={s.state === "current" ? "step" : undefined}
            >
              <span className="tracking-step-dot" aria-hidden>
                {s.state === "done" ? (
                  <Check size={12} />
                ) : s.key === "shipped" ? (
                  <Truck size={12} className="rtl:-scale-x-100" />
                ) : null}
              </span>
              <span className="tracking-step-label">
                {t(`tracking.steps.${s.key}`)}
                <span className="sr-only">
                  {s.state === "done"
                    ? ` ${t("tracking.stepDone")}`
                    : s.state === "current"
                      ? ` ${t("tracking.stepCurrent")}`
                      : ""}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {AlertIcon && p.alert && (
        <p role="status" className="tracking-alert" data-kind={p.alert}>
          <AlertIcon size={16} aria-hidden />
          {t(`tracking.alerts.${p.alert}`)}
        </p>
      )}
    </div>
  );
}
