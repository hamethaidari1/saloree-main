import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardPaste, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StoreRow } from "@/data/db";
import { money } from "@/services/catalog";
import { orderTotal } from "@/services/orders";
import { sellerService, type SellerOrder } from "@/services/seller";
import { shippingError, shippingService } from "@/services/shipping";
import {
  applyPasteFill,
  fillEmptyCarriers,
  parsePastedNumbers,
  planPasteFill,
  saveTrackingRows,
  shippableOrders,
  shortOrderId,
  validateRows,
  type DraftRow,
  type PastePlan,
  type RowErrors,
} from "@/services/bulk-tracking";

type Phase =
  | { kind: "edit" }
  | { kind: "saving"; done: number; total: number }
  | { kind: "saved"; saved: number; failed: number };

const place = (o: SellerOrder) => [o.city, o.country].filter(Boolean).join(", ") || "—";
const itemCount = (o: SellerOrder) => o.order_items.reduce((s, i) => s + i.quantity, 0);

/** "Add tracking numbers": type (or paste) tracking for every order waiting to ship. */
export function BulkTracking({ stores }: { stores: StoreRow[] }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const storeIds = stores.map((s) => s.id);
  const ordersKey = ["seller", "orders", ...storeIds];

  const orders = useQuery({
    queryKey: ordersKey,
    queryFn: () => sellerService.getOrders(storeIds),
    enabled: open,
  });
  const orderIds = orders.data?.map((o) => o.id) ?? [];
  const shipments = useQuery({
    queryKey: ["shipments", "bulk", ...orderIds],
    queryFn: () => shippingService.forOrders(orderIds),
    enabled: open && orders.isSuccess,
  });
  const carriers = useQuery({
    queryKey: ["carriers", "active"],
    queryFn: shippingService.activeCarriers,
    enabled: open,
    retry: false,
  });
  const loadError = orders.error ?? shipments.error ?? carriers.error;
  const ready = orders.isSuccess && shipments.isSuccess && carriers.isSuccess;

  // Orders saved in this dialog disappear at once (before the refetch lands).
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(new Set());
  const eligible = useMemo(() => {
    if (!orders.data || !shipments.data) return [];
    const withShipment = new Set(shipments.data.map((s) => s.order_id));
    return shippableOrders(orders.data, withShipment).filter((o) => !savedIds.has(o.id));
  }, [orders.data, shipments.data, savedIds]);

  const [draft, setDraft] = useState<Record<string, { carrierId: string; tracking: string }>>({});
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>({ kind: "edit" });
  const [query, setQuery] = useState("");
  const [allCarrier, setAllCarrier] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [pastePlan, setPastePlan] = useState<PastePlan | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const trackingInputs = useRef(new Map<string, HTMLInputElement>());

  const rowOf = (orderId: string): DraftRow => ({
    orderId,
    carrierId: draft[orderId]?.carrierId ?? "",
    tracking: draft[orderId]?.tracking ?? "",
  });
  const rows = eligible.map((o) => rowOf(o.id));
  const carrierIds = useMemo(
    () => new Set((carriers.data ?? []).map((c) => c.id)),
    [carriers.data],
  );
  const check = validateRows(rows, carrierIds);
  const shownErrors = (orderId: string): RowErrors =>
    checked.has(orderId) ? (check.errors[orderId] ?? {}) : {};

  const q = query.trim().toLowerCase().replace(/^#/, "");
  const visible = q
    ? eligible.filter(
        (o) => o.id.toLowerCase().startsWith(q) || (o.full_name ?? "").toLowerCase().includes(q),
      )
    : eligible;

  const setRow = (orderId: string, patch: Partial<{ carrierId: string; tracking: string }>) => {
    setDraft((d) => ({
      ...d,
      [orderId]: {
        carrierId: d[orderId]?.carrierId ?? "",
        tracking: d[orderId]?.tracking ?? "",
        ...patch,
      },
    }));
    // Editing a row that failed clears its old error (it is checked again on save).
    setFailures((f) => {
      if (!(orderId in f)) return f;
      const next = { ...f };
      delete next[orderId];
      return next;
    });
  };
  const markChecked = (orderId: string) =>
    setChecked((s) => (s.has(orderId) ? s : new Set([...s, orderId])));

  const unsaved = check.filled;
  const saving = phase.kind === "saving";

  const reset = () => {
    setDraft({});
    setChecked(new Set());
    setFailures({});
    setPhase({ kind: "edit" });
    setQuery("");
    setAllCarrier("");
    setPasteText("");
    setPastePlan(null);
    setConfirmClose(false);
    setSavedIds(new Set());
  };
  const close = () => {
    setOpen(false);
    reset();
  };
  const requestClose = () => {
    if (saving) return;
    if (unsaved > 0) setConfirmClose(true);
    else close();
  };

  const save = async () => {
    // Show every problem first; nothing is sent while a filled row is invalid.
    setChecked(new Set(rows.filter((r) => r.tracking.trim()).map((r) => r.orderId)));
    const firstBad = rows.find((r) => check.errors[r.orderId]);
    if (firstBad) {
      trackingInputs.current.get(firstBad.orderId)?.focus();
      return;
    }
    if (!check.ready.length) return;
    setPhase({ kind: "saving", done: 0, total: check.ready.length });
    const results = await saveTrackingRows(check.ready, (done, total) =>
      setPhase({ kind: "saving", done, total }),
    );
    const ok = results.filter((r) => r.ok).map((r) => r.orderId);
    const failed: Record<string, string> = {};
    for (const r of results) if (!r.ok) failed[r.orderId] = r.error;
    setSavedIds((s) => new Set([...s, ...ok]));
    setDraft((d) => {
      const next = { ...d };
      for (const id of ok) delete next[id];
      return next;
    });
    setFailures(failed);
    setPhase({ kind: "saved", saved: ok.length, failed: results.length - ok.length });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ordersKey }),
      queryClient.invalidateQueries({ queryKey: ["shipments"] }),
      queryClient.invalidateQueries({ queryKey: ["seller", "pending-count"] }),
    ]);
  };

  /** Enter in a tracking field → the next row's tracking field (never submits). */
  const onTrackingKey = (e: KeyboardEvent<HTMLInputElement>, orderId: string) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    markChecked(orderId);
    const i = visible.findIndex((o) => o.id === orderId);
    const next = visible[i + 1];
    if (next) trackingInputs.current.get(next.id)?.focus();
  };

  const pasted = parsePastedNumbers(pasteText);
  const emptyVisible = visible.map((o) => rowOf(o.id)).filter((r) => !r.tracking.trim()).length;
  const fillCount = Math.min(pasted.length, emptyVisible);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Truck /> Add tracking numbers
      </Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : requestClose())}>
        <DialogContent className="bulk-dialog sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Add tracking numbers</DialogTitle>
            <DialogDescription>
              Orders that can ship and have no tracking yet. Fill in the ones you've sent; empty
              rows are skipped. Each saved row becomes an "In transit" shipment.
            </DialogDescription>
          </DialogHeader>

          {confirmClose ? (
            <div role="alertdialog" aria-labelledby="bulk-close-title" className="bulk-confirm">
              <p id="bulk-close-title" className="font-semibold">
                You have {unsaved} unsaved tracking number{unsaved === 1 ? "" : "s"}. Close anyway?
              </p>
              <div className="bulk-confirm-actions">
                <Button autoFocus onClick={() => setConfirmClose(false)}>
                  Keep editing
                </Button>
                <Button variant="outline" onClick={close}>
                  Close without saving
                </Button>
              </div>
            </div>
          ) : !ready ? (
            loadError ? (
              <p role="alert" className="seller-error">
                {shippingError(loadError)}
              </p>
            ) : (
              <div className="nav-skeleton" aria-busy="true" aria-label="Loading orders" />
            )
          ) : eligible.length === 0 && phase.kind !== "saved" ? (
            <p className="bulk-empty">No orders are waiting to ship.</p>
          ) : (
            <div className="bulk-body">
              {phase.kind === "saving" && (
                <p role="status" className="bulk-status">
                  Saving {phase.done} of {phase.total}…
                </p>
              )}
              {phase.kind === "saved" && (
                <p
                  role="status"
                  className="bulk-status"
                  data-failed={phase.failed > 0 || undefined}
                >
                  Saved {phase.saved} tracking number{phase.saved === 1 ? "" : "s"}
                  {phase.failed > 0 &&
                    ` · ${phase.failed} failed — fix the rows marked below and save again`}
                  .
                </p>
              )}

              {eligible.length === 0 ? (
                <p className="bulk-empty">No orders are waiting to ship.</p>
              ) : (
                <>
                  <div className="bulk-tools">
                    <div className="seller-field">
                      <label htmlFor="bulk-all-carrier" className="seller-label">
                        Same carrier for all rows
                      </label>
                      <select
                        id="bulk-all-carrier"
                        aria-describedby="bulk-all-carrier-hint"
                        className="seller-select"
                        value={allCarrier}
                        disabled={saving}
                        onChange={(e) => {
                          const id = e.target.value;
                          setAllCarrier(id);
                          if (!id) return;
                          setDraft((d) => {
                            const next = { ...d };
                            for (const r of fillEmptyCarriers(rows, id))
                              next[r.orderId] = { carrierId: r.carrierId, tracking: r.tracking };
                            return next;
                          });
                        }}
                      >
                        <option value="">Choose…</option>
                        {carriers.data?.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <span id="bulk-all-carrier-hint" className="seller-hint">
                        Fills rows without a carrier.
                      </span>
                    </div>
                    <label className="seller-field">
                      <span className="seller-label">Search</span>
                      <Input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Order number or customer"
                      />
                    </label>
                  </div>

                  {!carriers.data?.length && (
                    <p role="alert" className="seller-error">
                      There are no active carriers yet. Ask an admin to add one.
                    </p>
                  )}

                  <div className="bulk-table-wrap">
                    <table className="seller-table bulk-table">
                      <caption className="sr-only">Orders waiting for a tracking number</caption>
                      <thead>
                        <tr>
                          <th scope="col">Order</th>
                          <th scope="col">Customer</th>
                          <th scope="col">City / country</th>
                          <th scope="col" className="text-end">
                            Items
                          </th>
                          <th scope="col" className="text-end">
                            Total
                          </th>
                          <th scope="col">Carrier</th>
                          <th scope="col">Tracking number</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((o) => {
                          const row = rowOf(o.id);
                          const err = shownErrors(o.id);
                          const failure = failures[o.id];
                          const short = shortOrderId(o.id);
                          return (
                            <tr
                              key={o.id}
                              data-invalid={
                                err.carrier || err.tracking || failure ? true : undefined
                              }
                            >
                              <td data-label="Order" className="font-mono">
                                #{short}
                              </td>
                              <td data-label="Customer">{o.full_name ?? "—"}</td>
                              <td data-label="City / country">{place(o)}</td>
                              <td data-label="Items" className="text-end">
                                {itemCount(o)}
                              </td>
                              <td data-label="Total" className="text-end">
                                {money(orderTotal(o), o.currency)}
                              </td>
                              <td data-label="Carrier">
                                <select
                                  className="seller-select bulk-input"
                                  aria-label={`Carrier for order #${short}`}
                                  aria-invalid={err.carrier ? true : undefined}
                                  aria-describedby={err.carrier ? `bulk-c-${o.id}` : undefined}
                                  value={row.carrierId}
                                  disabled={saving}
                                  onChange={(e) => setRow(o.id, { carrierId: e.target.value })}
                                >
                                  <option value="">Choose…</option>
                                  {carriers.data?.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name}
                                    </option>
                                  ))}
                                </select>
                                {err.carrier && (
                                  <p id={`bulk-c-${o.id}`} className="seller-error">
                                    {err.carrier}
                                  </p>
                                )}
                              </td>
                              <td data-label="Tracking number">
                                <Input
                                  ref={(el) => {
                                    if (el) trackingInputs.current.set(o.id, el);
                                    else trackingInputs.current.delete(o.id);
                                  }}
                                  className="bulk-input font-mono"
                                  aria-label={`Tracking number for order #${short}`}
                                  aria-invalid={err.tracking || failure ? true : undefined}
                                  aria-describedby={
                                    [err.tracking && `bulk-t-${o.id}`, failure && `bulk-f-${o.id}`]
                                      .filter(Boolean)
                                      .join(" ") || undefined
                                  }
                                  inputMode="text"
                                  autoCapitalize="characters"
                                  autoComplete="off"
                                  spellCheck={false}
                                  value={row.tracking}
                                  disabled={saving}
                                  onChange={(e) => setRow(o.id, { tracking: e.target.value })}
                                  onBlur={() => row.tracking.trim() && markChecked(o.id)}
                                  onKeyDown={(e) => onTrackingKey(e, o.id)}
                                />
                                {err.tracking && (
                                  <p id={`bulk-t-${o.id}`} className="seller-error">
                                    {err.tracking}
                                  </p>
                                )}
                                {failure && (
                                  <p id={`bulk-f-${o.id}`} className="seller-error" role="alert">
                                    Not saved: {failure}
                                  </p>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {visible.length === 0 && (
                          <tr>
                            <td colSpan={7} className="bulk-empty">
                              No order matches "{query}".
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <details className="bulk-paste">
                    <summary>
                      <ClipboardPaste size={16} aria-hidden /> Paste tracking numbers (one per line)
                    </summary>
                    <label className="seller-field">
                      <span className="seller-label">Tracking numbers, one per line</span>
                      <Textarea
                        className="font-mono"
                        rows={4}
                        value={pasteText}
                        disabled={saving}
                        onChange={(e) => {
                          setPasteText(e.target.value);
                          setPastePlan(null);
                        }}
                      />
                    </label>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!fillCount || saving}
                      onClick={() =>
                        setPastePlan(
                          planPasteFill(
                            visible.map((o) => rowOf(o.id)),
                            pasted,
                          ),
                        )
                      }
                    >
                      Fill the first {fillCount} empty row{fillCount === 1 ? "" : "s"}
                    </Button>
                    {pasted.length > 0 && !emptyVisible && (
                      <p className="seller-hint">There are no empty tracking cells to fill.</p>
                    )}
                    {pastePlan && (
                      <div className="bulk-preview" role="region" aria-label="Preview">
                        <p className="seller-label">Check before applying:</p>
                        <ul>
                          {pastePlan.assignments.map((a) => (
                            <li key={a.orderId}>
                              <span className="font-mono">#{shortOrderId(a.orderId)}</span> →{" "}
                              <span className="font-mono">{a.tracking}</span>
                            </li>
                          ))}
                        </ul>
                        {pastePlan.leftover.length > 0 && (
                          <p className="seller-hint">
                            {pastePlan.leftover.length} number
                            {pastePlan.leftover.length === 1 ? "" : "s"} won't be used (no more
                            empty rows): {pastePlan.leftover.join(", ")}
                          </p>
                        )}
                        <div className="bulk-confirm-actions">
                          <Button
                            type="button"
                            onClick={() => {
                              const next = applyPasteFill(rows, pastePlan);
                              setDraft((d) => {
                                const out = { ...d };
                                for (const r of next)
                                  out[r.orderId] = { carrierId: r.carrierId, tracking: r.tracking };
                                return out;
                              });
                              setPastePlan(null);
                              setPasteText(pastePlan.leftover.join("\n"));
                            }}
                          >
                            Apply
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setPastePlan(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </details>
                </>
              )}
            </div>
          )}

          {!confirmClose && (
            <DialogFooter className="bulk-footer">
              <Button variant="outline" disabled={saving} onClick={requestClose}>
                Close
              </Button>
              {ready && eligible.length > 0 && (
                <Button disabled={saving || check.filled === 0} onClick={() => void save()}>
                  {saving
                    ? "Saving…"
                    : check.filled
                      ? `Save ${check.filled} tracking number${check.filled === 1 ? "" : "s"}`
                      : "Save tracking numbers"}
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
