import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ShipmentStatusBadge,
  ShipmentTimeline,
  TrackLink,
} from "@/components/tracking/tracking-ui";
import type { CarrierRow, ShipmentStatus } from "@/data/db";
import { isShipmentStatus, SHIPMENT_STATUSES, statusLabel } from "@/lib/tracking";
import {
  shipmentEditSchema,
  shipmentInputSchema,
  shipmentUpdateSchema,
  shippingError,
  shippingService,
  type Shipment,
} from "@/services/shipping";

const OTHER = "__other__";
type Errors = Record<string, string | undefined>;
const fieldErrors = (issues: { path: (string | number)[]; message: string }[]): Errors =>
  Object.fromEntries(issues.map((i) => [String(i.path[0] ?? "form"), i.message]));

/** A known carrier (id) or "Other" with a typed name. */
type CarrierChoice = { carrierId: string; carrierName: string; other: boolean };
const carrierPayload = (c: CarrierChoice) => ({
  carrier_id: c.other ? "" : c.carrierId,
  carrier_name: c.other ? c.carrierName.trim() : "",
});

/** Carrier <select> from the active carriers, plus "Other" with a free-text name. */
function CarrierFields({
  carriers,
  value,
  onChange,
  error,
}: {
  carriers: CarrierRow[];
  value: CarrierChoice;
  onChange: (v: CarrierChoice) => void;
  error?: string | undefined;
}) {
  const id = useId();
  const choice = value.other ? OTHER : value.carrierId;
  return (
    <div className="seller-form-row">
      <div className="seller-field">
        <Label htmlFor={`${id}-carrier`}>Carrier</Label>
        <select
          id={`${id}-carrier`}
          className="seller-select"
          value={choice}
          onChange={(e) =>
            onChange(
              e.target.value === OTHER
                ? { ...value, carrierId: "", other: true }
                : { carrierId: e.target.value, carrierName: "", other: false },
            )
          }
        >
          <option value="">Choose a carrier</option>
          {carriers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
          <option value={OTHER}>Other…</option>
        </select>
      </div>
      {choice === OTHER && (
        <div className="seller-field">
          <Label htmlFor={`${id}-name`}>Carrier name</Label>
          <Input
            id={`${id}-name`}
            value={value.carrierName}
            maxLength={80}
            onChange={(e) => onChange({ ...value, carrierName: e.target.value })}
          />
        </div>
      )}
      {error && <p className="seller-error col-span-full">{error}</p>}
    </div>
  );
}

function useShippingRefresh(orderId: string, ordersKey: readonly unknown[]) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["shipments", orderId] }),
      // The database moves the order to shipped / delivered; refetch so the badge updates.
      queryClient.invalidateQueries({ queryKey: ordersKey }),
      queryClient.invalidateQueries({ queryKey: ["seller", "pending-count"] }),
      queryClient.invalidateQueries({ queryKey: ["seller", "analytics"] }),
    ]);
}

function AddTrackingForm({
  orderId,
  carriers,
  onDone,
  refresh,
}: {
  orderId: string;
  carriers: CarrierRow[];
  onDone: () => void;
  refresh: () => Promise<unknown>;
}) {
  const id = useId();
  const [carrier, setCarrier] = useState<CarrierChoice>({
    carrierId: "",
    carrierName: "",
    other: false,
  });
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [status, setStatus] = useState<ShipmentStatus>("in_transit");
  const [errors, setErrors] = useState<Errors>({});
  const input = () => ({
    ...carrierPayload(carrier),
    tracking_number: trackingNumber,
    tracking_url: trackingUrl,
    status,
  });
  const add = useMutation({
    mutationFn: () => shippingService.add(orderId, input()),
    onSuccess: async () => {
      toast.success("Tracking added");
      await refresh();
      onDone();
    },
    onError: (e) => setErrors({ form: shippingError(e) }),
  });
  return (
    <form
      className="seller-form tracking-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = shipmentInputSchema.safeParse(input());
        if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
        setErrors({});
        add.mutate();
      }}
    >
      <CarrierFields
        carriers={carriers}
        value={carrier}
        onChange={setCarrier}
        error={errors["carrier_name"] ?? errors["carrier_id"]}
      />
      <div className="seller-form-row">
        <div className="seller-field">
          <Label htmlFor={`${id}-number`}>Tracking number</Label>
          <Input
            id={`${id}-number`}
            value={trackingNumber}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!errors["tracking_number"]}
            onChange={(e) => setTrackingNumber(e.target.value)}
          />
          {errors["tracking_number"] && <p className="seller-error">{errors["tracking_number"]}</p>}
        </div>
        <div className="seller-field">
          <Label htmlFor={`${id}-status`}>Status</Label>
          <select
            id={`${id}-status`}
            className="seller-select"
            value={status}
            onChange={(e) => isShipmentStatus(e.target.value) && setStatus(e.target.value)}
          >
            {SHIPMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="seller-field">
        <Label htmlFor={`${id}-url`}>Custom tracking link (optional)</Label>
        <Input
          id={`${id}-url`}
          type="url"
          inputMode="url"
          placeholder="https://"
          value={trackingUrl}
          aria-invalid={!!errors["tracking_url"]}
          onChange={(e) => setTrackingUrl(e.target.value)}
        />
        {errors["tracking_url"] ? (
          <p className="seller-error">{errors["tracking_url"]}</p>
        ) : (
          <p className="seller-hint">Leave empty to use the carrier's own tracking page.</p>
        )}
      </div>
      {errors["form"] && (
        <p role="alert" className="seller-error">
          {errors["form"]}
        </p>
      )}
      <div className="seller-form-actions">
        <Button type="button" variant="ghost" onClick={onDone} disabled={add.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={add.isPending}>
          {add.isPending ? "Adding…" : "Add tracking"}
        </Button>
      </div>
    </form>
  );
}

function EditShipmentForm({
  shipment,
  carriers,
  onDone,
  refresh,
}: {
  shipment: Shipment;
  carriers: CarrierRow[];
  onDone: () => void;
  refresh: () => Promise<unknown>;
}) {
  const id = useId();
  const [carrier, setCarrier] = useState<CarrierChoice>({
    carrierId: shipment.carrier_id ?? "",
    carrierName: shipment.carrier_id ? "" : (shipment.carrier_name ?? ""),
    other: !shipment.carrier_id,
  });
  const [trackingNumber, setTrackingNumber] = useState(shipment.tracking_number);
  const [trackingUrl, setTrackingUrl] = useState(shipment.tracking_url ?? "");
  const [errors, setErrors] = useState<Errors>({});
  const input = () => ({
    ...carrierPayload(carrier),
    tracking_number: trackingNumber,
    tracking_url: trackingUrl,
  });
  const save = useMutation({
    mutationFn: () => shippingService.edit(shipment.id, input()),
    onSuccess: async () => {
      toast.success("Shipment updated");
      await refresh();
      onDone();
    },
    onError: (e) => setErrors({ form: shippingError(e) }),
  });
  // A carrier that was disabled since still shows in the picker for this shipment.
  const options =
    shipment.carriers && !carriers.some((c) => c.id === shipment.carriers?.id)
      ? [...carriers, shipment.carriers]
      : carriers;
  return (
    <form
      className="seller-form tracking-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = shipmentEditSchema.safeParse(input());
        if (!parsed.success) return setErrors(fieldErrors(parsed.error.issues));
        setErrors({});
        save.mutate();
      }}
    >
      <CarrierFields
        carriers={options}
        value={carrier}
        onChange={setCarrier}
        error={errors["carrier_name"]}
      />
      <div className="seller-form-row">
        <div className="seller-field">
          <Label htmlFor={`${id}-number`}>Tracking number</Label>
          <Input
            id={`${id}-number`}
            value={trackingNumber}
            maxLength={64}
            spellCheck={false}
            onChange={(e) => setTrackingNumber(e.target.value)}
          />
          {errors["tracking_number"] && <p className="seller-error">{errors["tracking_number"]}</p>}
        </div>
        <div className="seller-field">
          <Label htmlFor={`${id}-url`}>Custom tracking link</Label>
          <Input
            id={`${id}-url`}
            type="url"
            placeholder="https://"
            value={trackingUrl}
            onChange={(e) => setTrackingUrl(e.target.value)}
          />
          {errors["tracking_url"] && <p className="seller-error">{errors["tracking_url"]}</p>}
        </div>
      </div>
      {errors["form"] && (
        <p role="alert" className="seller-error">
          {errors["form"]}
        </p>
      )}
      <div className="seller-form-actions">
        <Button type="button" variant="ghost" onClick={onDone} disabled={save.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function AddUpdateForm({
  shipment,
  refresh,
}: {
  shipment: Shipment;
  refresh: () => Promise<unknown>;
}) {
  const id = useId();
  const [status, setStatus] = useState<ShipmentStatus>(
    isShipmentStatus(shipment.status) ? shipment.status : "in_transit",
  );
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const update = useMutation({
    mutationFn: () => shippingService.addUpdate(shipment.id, { status, description, location }),
    onSuccess: async () => {
      toast.success(`Marked as ${statusLabel(status).toLowerCase()}`);
      setDescription("");
      setLocation("");
      await refresh();
    },
    onError: (e) => setError(shippingError(e)),
  });
  return (
    <form
      className="tracking-update"
      noValidate
      aria-label={`Add an update to ${shipment.tracking_number}`}
      onSubmit={(e) => {
        e.preventDefault();
        const parsed = shipmentUpdateSchema.safeParse({ status, description, location });
        if (!parsed.success)
          return setError(parsed.error.issues[0]?.message ?? "Check the update.");
        setError(null);
        update.mutate();
      }}
    >
      <div className="seller-field">
        <Label htmlFor={`${id}-status`}>Status</Label>
        <select
          id={`${id}-status`}
          className="seller-select"
          value={status}
          onChange={(e) => isShipmentStatus(e.target.value) && setStatus(e.target.value)}
        >
          {SHIPMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </select>
      </div>
      <div className="seller-field">
        <Label htmlFor={`${id}-note`}>Note</Label>
        <Input
          id={`${id}-note`}
          value={description}
          maxLength={500}
          placeholder="Optional"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="seller-field">
        <Label htmlFor={`${id}-loc`}>Location</Label>
        <Input
          id={`${id}-loc`}
          value={location}
          maxLength={120}
          placeholder="Optional"
          onChange={(e) => setLocation(e.target.value)}
        />
      </div>
      <Button type="submit" size="sm" disabled={update.isPending} className="self-end">
        {update.isPending ? "Saving…" : "Add update"}
      </Button>
      {error && (
        <p role="alert" className="seller-error col-span-full">
          {error}
        </p>
      )}
    </form>
  );
}

function ShipmentCard({
  shipment,
  carriers,
  refresh,
}: {
  shipment: Shipment;
  carriers: CarrierRow[];
  refresh: () => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const delivered = shipment.status === "delivered";
  return (
    <li className="tracking-card">
      <div className="flex flex-wrap items-center gap-2">
        <strong className="text-sm">
          {shipment.carriers?.name ?? shipment.carrier_name ?? "Carrier"}
        </strong>
        <span className="font-mono text-xs">{shipment.tracking_number}</span>
        <ShipmentStatusBadge status={shipment.status} />
        <span className="ms-auto flex gap-2">
          <TrackLink shipment={shipment} carrier={shipment.carriers} />
          {!delivered && !editing && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Edit shipment ${shipment.tracking_number}`}
              onClick={() => setEditing(true)}
            >
              <Pencil /> Edit
            </Button>
          )}
        </span>
      </div>
      {editing && (
        <EditShipmentForm
          shipment={shipment}
          carriers={carriers}
          onDone={() => setEditing(false)}
          refresh={refresh}
        />
      )}
      <ShipmentTimeline events={shipment.shipment_events} />
      {delivered ? (
        <p className="seller-hint">Delivered shipments can't be changed.</p>
      ) : (
        <AddUpdateForm shipment={shipment} refresh={refresh} />
      )}
    </li>
  );
}

/** "Shipping" section of the seller's order drawer. */
export function ShippingSection({
  orderId,
  orderStatus,
  ordersKey,
}: {
  orderId: string;
  orderStatus: string;
  ordersKey: readonly unknown[];
}) {
  const shipments = useQuery({
    queryKey: ["shipments", orderId],
    queryFn: () => shippingService.forOrders([orderId]),
    retry: false,
  });
  const carriers = useQuery({
    queryKey: ["carriers", "active"],
    queryFn: shippingService.activeCarriers,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const [adding, setAdding] = useState(false);
  const refresh = useShippingRefresh(orderId, ordersKey);
  const closed = orderStatus === "cancelled" || orderStatus === "delivered";

  return (
    <section aria-labelledby="od-shipping" className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="od-shipping" className="font-semibold">
          Shipping
        </h3>
        {!closed && !adding && shipments.isSuccess && carriers.isSuccess && (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus /> Add tracking
          </Button>
        )}
      </div>
      {shipments.isPending || carriers.isPending ? (
        <div className="nav-skeleton" aria-busy="true" aria-label="Loading shipping" />
      ) : shipments.isError || carriers.isError ? (
        <p role="alert" className="seller-error">
          {shippingError(shipments.error ?? carriers.error)}
        </p>
      ) : (
        <>
          {adding && (
            <AddTrackingForm
              orderId={orderId}
              carriers={carriers.data}
              onDone={() => setAdding(false)}
              refresh={refresh}
            />
          )}
          {!shipments.data.length && !adding && (
            <p className="seller-hint">
              {orderStatus === "cancelled"
                ? "This order was cancelled, so it can't be shipped."
                : "No tracking yet. Add the carrier and tracking number once you've sent it."}
            </p>
          )}
          {shipments.data.length > 0 && (
            <ul className="grid gap-3">
              {shipments.data.map((s) => (
                <ShipmentCard key={s.id} shipment={s} carriers={carriers.data} refresh={refresh} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
