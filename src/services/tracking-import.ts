import { z } from "zod";
import type { CarrierRow } from "@/data/db";
import { shippingError, shippingService, trackingNumberSchema } from "./shipping";

export const MAX_IMPORT_ROWS = 200;
export const IMPORT_COLUMNS = ["order_id", "carrier_code", "tracking_number"] as const;

/**
 * Minimal RFC 4180 CSV parser: commas, quoted fields with "" escapes,
 * CRLF/LF line ends, a UTF-8 BOM. Blank lines are skipped.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  // Drop a UTF-8 byte-order mark (Excel adds one).
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

export interface ImportRow {
  /** 1-based line in the file (header = line 1). */
  line: number;
  order_id: string;
  carrier_code: string;
  tracking_number: string;
  /** Resolved carrier when valid. */
  carrier?: CarrierRow;
  errors: string[];
}

export type ImportPlan =
  { ok: false; error: string } | { ok: true; rows: ImportRow[]; valid: ImportRow[] };

const rowSchema = z.object({
  order_id: z.string().trim().uuid("order_id must be an order ID (UUID)."),
  carrier_code: z.string().trim().toLowerCase().min(1, "carrier_code is empty."),
  tracking_number: trackingNumberSchema,
});

/**
 * Reads the file text and validates every row against the active carriers
 * and the seller's own orders. Nothing is written here.
 */
export function planImport(
  text: string,
  opts: { carriers: CarrierRow[]; orderIds: Set<string> },
): ImportPlan {
  const table = parseCsv(text);
  const header = table[0]?.map((h) => h.trim().toLowerCase());
  if (!header) return { ok: false, error: "The file is empty." };
  const index = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<
    (typeof IMPORT_COLUMNS)[number],
    number
  >;
  const missing = IMPORT_COLUMNS.filter((c) => index[c] < 0);
  if (missing.length)
    return {
      ok: false,
      error: `The first line must be the column names: ${IMPORT_COLUMNS.join(",")} (missing: ${missing.join(", ")}).`,
    };
  const body = table.slice(1);
  if (!body.length) return { ok: false, error: "The file has no rows after the header." };
  if (body.length > MAX_IMPORT_ROWS)
    return {
      ok: false,
      error: `The file has ${body.length} rows; import at most ${MAX_IMPORT_ROWS} at a time.`,
    };

  const byCode = new Map(opts.carriers.map((c) => [c.code.toLowerCase(), c]));
  const seen = new Set<string>();
  const rows = body.map((cells, i): ImportRow => {
    const raw = {
      order_id: (cells[index.order_id] ?? "").trim(),
      carrier_code: (cells[index.carrier_code] ?? "").trim(),
      tracking_number: (cells[index.tracking_number] ?? "").trim(),
    };
    const row: ImportRow = { line: i + 2, ...raw, errors: [] };
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      row.errors.push(...parsed.error.issues.map((x) => x.message));
      return row;
    }
    const v = parsed.data;
    row.carrier_code = v.carrier_code;
    row.tracking_number = v.tracking_number;
    const carrier = byCode.get(v.carrier_code);
    if (!carrier) row.errors.push(`Unknown or disabled carrier code "${v.carrier_code}".`);
    else row.carrier = carrier;
    if (!opts.orderIds.has(v.order_id)) row.errors.push("Order not found in this store.");
    const key = `${v.order_id}|${v.tracking_number.toLowerCase()}`;
    if (seen.has(key)) row.errors.push("Duplicate of an earlier row in this file.");
    seen.add(key);
    return row;
  });
  return { ok: true, rows, valid: rows.filter((r) => !r.errors.length) };
}

export interface ImportResult {
  line: number;
  order_id: string;
  tracking_number: string;
  ok: boolean;
  reason?: string;
}

/** Adds valid rows one at a time (so one failure never blocks the rest). */
export async function runImport(
  rows: ImportRow[],
  onProgress?: (done: number, total: number) => void,
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const [i, r] of rows.entries()) {
    try {
      if (!r.carrier) throw new Error("Unknown carrier.");
      await shippingService.add(r.order_id, {
        carrier_id: r.carrier.id,
        carrier_name: null,
        tracking_number: r.tracking_number,
        tracking_url: null,
        status: "in_transit",
      });
      results.push({
        line: r.line,
        order_id: r.order_id,
        tracking_number: r.tracking_number,
        ok: true,
      });
    } catch (e) {
      results.push({
        line: r.line,
        order_id: r.order_id,
        tracking_number: r.tracking_number,
        ok: false,
        reason: shippingError(e),
      });
    }
    onProgress?.(i + 1, rows.length);
  }
  return results;
}
