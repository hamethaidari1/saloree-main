import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTemplateCsv,
  downloadText,
  formatBytes,
  MAX_CSV_BYTES,
  pickExampleOrder,
  TEMPLATE_FILE_NAME,
  validateCsvFile,
} from "@/lib/csv-file";
import { planImport } from "@/services/tracking-import";

const ORDER = "11111111-1111-4111-8111-111111111111";
const ORDER2 = "22222222-2222-4222-8222-222222222222";

afterEach(() => vi.restoreAllMocks());

describe("validateCsvFile", () => {
  it("accepts .csv files up to 1 MB (any case)", () => {
    expect(validateCsvFile({ name: "tracking.csv", size: 120 })).toBeNull();
    expect(validateCsvFile({ name: "TRACKING.CSV", size: MAX_CSV_BYTES })).toBeNull();
  });
  it.each(["tracking.txt", "tracking.xlsx", "tracking.csv.exe", "csv"])(
    "rejects %j as not a CSV",
    (name) => expect(validateCsvFile({ name, size: 10 })).toMatch(/isn't a CSV file/),
  );
  it("rejects files over 1 MB, even by one byte", () =>
    expect(validateCsvFile({ name: "big.csv", size: MAX_CSV_BYTES + 1 })).toBe(
      "That file is larger than 1 MB. Split it into smaller files.",
    ));
  it("rejects empty files", () =>
    expect(validateCsvFile({ name: "empty.csv", size: 0 })).toMatch(/empty/));
});

describe("formatBytes", () => {
  it("is readable", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(MAX_CSV_BYTES)).toBe("1 MB");
  });
});

describe("download template", () => {
  it("example row uses the first order that can still ship", () => {
    expect(
      pickExampleOrder([
        { id: "a", status: "cancelled" },
        { id: "b", status: "delivered" },
        { id: ORDER, status: "pending" },
        { id: ORDER2, status: "shipped" },
      ])?.id,
    ).toBe(ORDER);
    expect(pickExampleOrder([{ id: "a", status: "cancelled" }])).toBeNull();
    expect(pickExampleOrder([])).toBeNull();
  });

  it("header plus one example row from a real order and carrier", () => {
    expect(buildTemplateCsv({ orderId: ORDER, carrierCode: "dhl" })).toBe(
      `order_id,carrier_code,tracking_number\r\n${ORDER},dhl,\r\n`,
    );
  });

  it("header only when there is no order (or carrier)", () =>
    expect(buildTemplateCsv(null)).toBe("order_id,carrier_code,tracking_number\r\n"));

  it("importing the template unchanged is rejected, never adds a made-up number", () => {
    const plan = planImport(buildTemplateCsv({ orderId: ORDER, carrierCode: "dhl" }), {
      carriers: [
        { id: "c", code: "dhl", name: "DHL", tracking_url_template: null, is_active: true },
      ],
      orderIds: new Set([ORDER]),
    });
    expect(plan.ok && plan.valid).toEqual([]);
    expect(plan.ok && plan.rows[0]?.errors.join(" ")).toMatch(/at least 4/);
  });

  it("downloads the CSV from the browser and frees the URL", () => {
    vi.useFakeTimers();
    const create = vi.fn((_blob: Blob) => "blob:template");
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadText(TEMPLATE_FILE_NAME, "a,b\r\n");
    const blob = create.mock.calls[0]?.[0];
    expect(blob?.type).toMatch(/text\/csv/);
    expect(click).toHaveBeenCalledOnce();
    const a = click.mock.contexts[0] as HTMLAnchorElement;
    expect(a.download).toBe(TEMPLATE_FILE_NAME);
    expect(a.href).toBe("blob:template");
    expect(document.querySelector("a[download]")).toBeNull(); // cleaned up
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:template");
    vi.useRealTimers();
  });
});
