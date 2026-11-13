import { useId, useState, type DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, FileUp, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StoreRow } from "@/data/db";
import {
  buildTemplateCsv,
  downloadText,
  formatBytes,
  MAX_CSV_BYTES,
  pickExampleOrder,
  TEMPLATE_FILE_NAME,
  validateCsvFile,
} from "@/lib/csv-file";
import { sellerService } from "@/services/seller";
import { shippingError, shippingService } from "@/services/shipping";
import {
  IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  planImport,
  runImport,
  type ImportPlan,
  type ImportResult,
} from "@/services/tracking-import";

type Phase =
  | { kind: "select" }
  | { kind: "running"; done: number; total: number }
  | { kind: "done"; results: ImportResult[] };

/** "Import tracking (CSV)": order_id, carrier_code, tracking_number. */
export function TrackingImport({ stores }: { stores: StoreRow[] }) {
  const queryClient = useQueryClient();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "select" });
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [dragging, setDragging] = useState(false);

  const storeIds = stores.map((s) => s.id);
  const ordersKey = ["seller", "orders", ...storeIds];
  const orders = useQuery({
    queryKey: ordersKey,
    queryFn: () => sellerService.getOrders(storeIds),
    enabled: open,
  });
  const carriers = useQuery({
    queryKey: ["carriers", "active"],
    queryFn: shippingService.activeCarriers,
    enabled: open,
    retry: false,
  });
  const ready = orders.isSuccess && carriers.isSuccess;
  const loadError = orders.error ?? carriers.error;

  const clearFile = () => {
    setFile(null);
    setFileError(null);
    setPlan(null);
  };
  const reset = () => {
    clearFile();
    setPhase({ kind: "select" });
  };

  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    const problem = validateCsvFile(picked);
    if (problem) {
      clearFile();
      setFileError(problem);
      return;
    }
    if (!orders.data || !carriers.data) return;
    setFileError(null);
    setFile({ name: picked.name, size: picked.size });
    setPlan(
      planImport(await picked.text(), {
        carriers: carriers.data,
        orderIds: new Set(orders.data.map((o) => o.id)),
      }),
    );
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragging(false);
    void choose(e.dataTransfer.files?.[0]);
  };

  const start = async () => {
    if (!plan?.ok || !plan.valid.length) return;
    setPhase({ kind: "running", done: 0, total: plan.valid.length });
    const results = await runImport(plan.valid, (done, total) =>
      setPhase({ kind: "running", done, total }),
    );
    setPhase({ kind: "done", results });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ordersKey }),
      queryClient.invalidateQueries({ queryKey: ["shipments"] }),
      queryClient.invalidateQueries({ queryKey: ["seller", "pending-count"] }),
    ]);
  };

  const example = (() => {
    const order = pickExampleOrder(orders.data ?? []);
    const carrier = carriers.data?.[0];
    return order && carrier ? { orderId: order.id, carrierCode: carrier.code } : null;
  })();
  const canImport = phase.kind === "select" && !!plan?.ok && plan.valid.length > 0 && !fileError;
  const running = phase.kind === "running";

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <FileUp /> Import tracking (CSV)
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          // Esc / overlay click close it — except while rows are being imported.
          if (running) return;
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="import-dialog sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Import tracking numbers</DialogTitle>
            <DialogDescription>
              Upload a CSV with the columns{" "}
              <code className="import-code">{IMPORT_COLUMNS.join(",")}</code> on the first line, up
              to {MAX_IMPORT_ROWS} rows. Each row becomes an "In transit" shipment.
            </DialogDescription>
          </DialogHeader>

          {phase.kind === "done" ? (
            <ImportSummary results={phase.results} />
          ) : running ? (
            <p role="status" className="text-sm">
              Importing… {phase.done} of {phase.total}
            </p>
          ) : !ready ? (
            loadError ? (
              <p role="alert" className="seller-error">
                {shippingError(loadError)}
              </p>
            ) : (
              <div className="nav-skeleton" aria-busy="true" aria-label="Loading" />
            )
          ) : (
            <div className="import-body">
              <div className="grid gap-2">
                {/* The input is visually hidden but focusable; the label is the drop zone. */}
                <label
                  htmlFor={inputId}
                  className="drop-zone"
                  data-dragging={dragging || undefined}
                  onDragEnter={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                >
                  <input
                    id={inputId}
                    type="file"
                    accept=".csv,text/csv"
                    className="sr-only"
                    aria-describedby={`${inputId}-help`}
                    onChange={(e) => {
                      void choose(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                  <UploadCloud aria-hidden className="drop-zone-icon" />
                  <span className="drop-zone-title">
                    {file ? "Choose a different file" : "Choose a CSV file"}
                    <span className="drop-zone-sub"> or drag it here</span>
                  </span>
                  <span id={`${inputId}-help`} className="drop-zone-sub">
                    .csv only, up to {formatBytes(MAX_CSV_BYTES)}
                  </span>
                </label>

                {file && (
                  <div className="file-chip">
                    <FileText size={16} aria-hidden />
                    <span className="min-w-0 flex-1 truncate" title={file.name}>
                      {file.name}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatBytes(file.size)}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearFile}
                      aria-label={`Remove ${file.name}`}
                    >
                      <X /> Remove
                    </Button>
                  </div>
                )}
                {fileError && (
                  <p role="alert" className="seller-error">
                    {fileError}
                  </p>
                )}
              </div>

              <div className="import-meta">
                <p className="text-sm">
                  <button
                    type="button"
                    className="import-link"
                    onClick={() => downloadText(TEMPLATE_FILE_NAME, buildTemplateCsv(example))}
                  >
                    <Download size={14} aria-hidden /> Download template
                  </button>
                  <span className="seller-hint">
                    {example
                      ? " — includes one example row from your orders; add the tracking number before importing."
                      : " — header only (you have no order that can still ship, or no active carrier)."}
                  </span>
                </p>
                <div className="grid gap-1.5">
                  <span className="seller-label">Carrier codes</span>
                  {carriers.data?.length ? (
                    <ul className="code-chips" aria-label="Active carrier codes">
                      {carriers.data.map((c) => (
                        <li key={c.id} title={c.name}>
                          {c.code}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="seller-hint">No active carriers yet. Ask an admin to add them.</p>
                  )}
                </div>
              </div>

              {plan && !plan.ok && (
                <p role="alert" className="seller-error">
                  {plan.error}
                </p>
              )}
              {plan?.ok && (
                <div className="grid gap-2">
                  <p className="text-sm" role="status">
                    {plan.valid.length} of {plan.rows.length} row
                    {plan.rows.length === 1 ? "" : "s"} ready to import
                    {plan.rows.length > plan.valid.length &&
                      ` · ${plan.rows.length - plan.valid.length} with errors (skipped)`}
                    .
                  </p>
                  <div className="import-table">
                    <table className="seller-table">
                      <thead>
                        <tr>
                          <th scope="col">Line</th>
                          <th scope="col">Order</th>
                          <th scope="col">Carrier</th>
                          <th scope="col">Tracking number</th>
                          <th scope="col">Check</th>
                        </tr>
                      </thead>
                      <tbody>
                        {plan.rows.map((r) => (
                          <tr key={r.line} data-invalid={r.errors.length > 0 || undefined}>
                            <td>{r.line}</td>
                            <td className="font-mono text-xs">{r.order_id.slice(0, 8) || "—"}</td>
                            <td>{r.carrier?.name ?? (r.carrier_code || "—")}</td>
                            <td className="font-mono text-xs">{r.tracking_number || "—"}</td>
                            <td>
                              {r.errors.length ? (
                                <span className="seller-error">{r.errors.join(" ")}</span>
                              ) : (
                                <span className="text-primary">OK</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {phase.kind === "done" ? (
              <>
                <Button variant="outline" onClick={reset}>
                  Import another file
                </Button>
                <Button
                  onClick={() => {
                    setOpen(false);
                    reset();
                  }}
                >
                  Done
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  disabled={running}
                  onClick={() => {
                    setOpen(false);
                    reset();
                  }}
                >
                  Cancel
                </Button>
                <Button disabled={!canImport} onClick={() => void start()}>
                  {running
                    ? "Importing…"
                    : plan?.ok && plan.valid.length
                      ? `Import ${plan.valid.length} row${plan.valid.length === 1 ? "" : "s"}`
                      : "Import"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ImportSummary({ results }: { results: ImportResult[] }) {
  const failed = results.filter((r) => !r.ok);
  return (
    <div className="import-body">
      <p role="status" className="text-sm">
        <strong>{results.length - failed.length} added</strong>, {failed.length} failed.
      </p>
      {failed.length > 0 && (
        <div className="import-table">
          <table className="seller-table">
            <thead>
              <tr>
                <th scope="col">Line</th>
                <th scope="col">Tracking number</th>
                <th scope="col">Reason</th>
              </tr>
            </thead>
            <tbody>
              {failed.map((r) => (
                <tr key={r.line}>
                  <td>{r.line}</td>
                  <td className="font-mono text-xs">{r.tracking_number}</td>
                  <td className="seller-error">{r.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
