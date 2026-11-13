/**
 * Browser-side helpers for the tracking CSV dialog: file checks, the
 * downloadable template and a tiny download helper. Pure apart from
 * `downloadText`, so they are easy to test.
 */
import { IMPORT_COLUMNS } from "@/services/tracking-import";

export const MAX_CSV_BYTES = 1024 * 1024; // 1 MB
export const TEMPLATE_FILE_NAME = "tracking-import-template.csv";

/** Plain-language problem with the chosen file, or null when it can be read. */
export function validateCsvFile(file: Pick<File, "name" | "size">): string | null {
  if (!/\.csv$/i.test(file.name.trim()))
    return `"${file.name}" isn't a CSV file. Choose a file ending in .csv.`;
  if (file.size === 0) return "That file is empty.";
  // No rounded size here: "1 MB, limit 1 MB" would be confusing for a file just over the limit.
  if (file.size > MAX_CSV_BYTES)
    return `That file is larger than ${formatBytes(MAX_CSV_BYTES)}. Split it into smaller files.`;
  return null;
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

/** Orders that can still get tracking (the database refuses cancelled / delivered). */
const SHIPPABLE = (status: string) => status !== "cancelled" && status !== "delivered";

/** The example order for the template: the seller's first order that can still ship. */
export function pickExampleOrder<T extends { id: string; status: string }>(orders: T[]) {
  return orders.find((o) => SHIPPABLE(o.status)) ?? null;
}

/**
 * Template CSV: the header, plus one example row from a real order and a
 * real active carrier code when both exist. The example's tracking number is
 * left empty on purpose, so importing the template unchanged is rejected
 * instead of adding a made-up tracking number to a real order.
 */
export function buildTemplateCsv(example: { orderId: string; carrierCode: string } | null) {
  const lines = [IMPORT_COLUMNS.join(",")];
  if (example) lines.push(`${example.orderId},${example.carrierCode},`);
  return `${lines.join("\r\n")}\r\n`;
}

/** Saves text as a file from the browser (no server round-trip). */
export function downloadText(fileName: string, text: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  // Give the browser a moment to start the download before freeing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
