import { useTranslation } from "react-i18next";
import { Package } from "lucide-react";
import type { Shipment } from "@/services/shipping";
import type { TFunction } from "i18next";
import { translateError } from "@/i18n/messages";
import { OrderProgress, ShipmentStatusBadge, ShipmentTimeline, TrackLink } from "./tracking-ui";

/**
 * Known tracking errors translated; unknown ones as the server reported them.
 * "Not set up yet" keeps the real database message next to it, so the owner
 * can see exactly what is missing.
 */
function trackingErrorText(t: TFunction, error: unknown) {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  if (
    typeof code === "string" &&
    ["PGRST205", "PGRST202", "PGRST200", "42P01", "42883"].includes(code)
  )
    return `${t("tracking.notReady", { ns: "errors" })} (${typeof message === "string" ? message : code})`;
  return translateError(t, error);
}

/** Tracking block for one order on My orders / the confirmation page. */
export function CustomerTracking({
  orderStatus,
  shipments,
  loading,
  error,
}: {
  orderStatus: string;
  shipments: Shipment[];
  loading: boolean;
  error: unknown;
}) {
  const { t } = useTranslation("orders");
  if (loading)
    return <div className="nav-skeleton" aria-busy="true" aria-label={t("tracking.loading")} />;
  if (error)
    return (
      <p role="alert" className="seller-error">
        {t("tracking.loadError")} {trackingErrorText(t, error)}
      </p>
    );
  return (
    <section className="tracking-card" aria-label={t("tracking.cardLabel")}>
      <OrderProgress orderStatus={orderStatus} shipments={shipments} />
      {!shipments.length ? (
        orderStatus !== "cancelled" && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Package size={16} aria-hidden /> {t("tracking.notShipped")}
          </p>
        )
      ) : (
        <ul className="grid gap-4">
          {shipments.map((s, i) => (
            <li key={s.id} className="grid gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="text-sm">
                  {shipments.length > 1 ? `${t("tracking.package", { number: i + 1 })} · ` : ""}
                  {s.carriers?.name ?? s.carrier_name ?? t("tracking.carrierFallback")}
                </strong>
                <bdi className="font-mono text-xs">{s.tracking_number}</bdi>
                <ShipmentStatusBadge status={s.status} />
                <TrackLink shipment={s} carrier={s.carriers} className="ms-auto" />
              </div>
              <ShipmentTimeline events={s.shipment_events} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
