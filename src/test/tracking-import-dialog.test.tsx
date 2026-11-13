import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const ORDER = "11111111-1111-4111-8111-111111111111";
const DELIVERED = "22222222-2222-4222-8222-222222222222";

const spies = vi.hoisted(() => ({
  getOrders: vi.fn(),
  activeCarriers: vi.fn(),
  downloadText: vi.fn(),
}));

vi.mock("@/services/seller", () => ({
  sellerService: { getOrders: spies.getOrders },
}));
vi.mock("@/services/shipping", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/services/shipping")>();
  return {
    ...real,
    shippingService: { ...real.shippingService, activeCarriers: spies.activeCarriers },
  };
});
vi.mock("@/lib/csv-file", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/csv-file")>();
  return { ...real, downloadText: spies.downloadText };
});

import { TrackingImport } from "@/components/seller/tracking-import";
import { MAX_CSV_BYTES } from "@/lib/csv-file";

/** A File whose text() works in jsdom. */
function csvFile(name: string, content: string, size?: number) {
  const file = new File([content], name, { type: "text/csv" });
  Object.defineProperty(file, "text", { value: async () => content });
  if (size !== undefined) Object.defineProperty(file, "size", { value: size });
  return file;
}

function setup() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <TrackingImport stores={[{ id: "s1" } as never]} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /import tracking/i }));
  return screen.findByRole("dialog");
}
const fileInput = (dialog: HTMLElement) =>
  within(dialog).getByLabelText(/choose a csv file/i) as HTMLInputElement;
const importButton = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", { name: /^import/i });

beforeEach(() => {
  spies.downloadText.mockReset();
  spies.getOrders.mockResolvedValue([
    { id: DELIVERED, status: "delivered" },
    { id: ORDER, status: "pending" },
  ]);
  spies.activeCarriers.mockResolvedValue([
    { id: "c1", code: "dhl", name: "DHL", tracking_url_template: null, is_active: true },
    { id: "c2", code: "aramex", name: "Aramex", tracking_url_template: null, is_active: true },
  ]);
});

describe("import dialog", () => {
  it("shows carrier codes as chips and starts with Import disabled", async () => {
    const dialog = await setup();
    const chips = await within(dialog).findByRole("list", { name: /active carrier codes/i });
    expect(
      within(chips)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(["dhl", "aramex"]);
    expect(importButton(dialog)).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeEnabled();
  });

  it("Download template uses the first shippable order and a real carrier code", async () => {
    const dialog = await setup();
    fireEvent.click(await within(dialog).findByRole("button", { name: /download template/i }));
    expect(spies.downloadText).toHaveBeenCalledWith(
      "tracking-import-template.csv",
      `order_id,carrier_code,tracking_number\r\n${ORDER},dhl,\r\n`,
    );
  });

  it("template is header-only when no order can ship", async () => {
    spies.getOrders.mockResolvedValue([{ id: DELIVERED, status: "delivered" }]);
    const dialog = await setup();
    fireEvent.click(await within(dialog).findByRole("button", { name: /download template/i }));
    expect(spies.downloadText).toHaveBeenCalledWith(
      "tracking-import-template.csv",
      "order_id,carrier_code,tracking_number\r\n",
    );
  });

  it("rejects a non-CSV file with a clear error", async () => {
    const dialog = await setup();
    await within(dialog).findByText(/carrier codes/i);
    fireEvent.change(fileInput(dialog), {
      target: { files: [csvFile("orders.xlsx", "x")] },
    });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/isn't a CSV file/);
    expect(importButton(dialog)).toBeDisabled();
  });

  it("rejects a file over 1 MB", async () => {
    const dialog = await setup();
    await within(dialog).findByText(/carrier codes/i);
    fireEvent.change(fileInput(dialog), {
      target: { files: [csvFile("big.csv", "x", MAX_CSV_BYTES + 1)] },
    });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/larger than 1 MB/);
    expect(importButton(dialog)).toBeDisabled();
  });

  it("a valid file shows its name and size, enables Import, and Remove resets it", async () => {
    const dialog = await setup();
    await within(dialog).findByText(/carrier codes/i);
    const content = `order_id,carrier_code,tracking_number\n${ORDER},dhl,ZX-12345\n`;
    fireEvent.change(fileInput(dialog), { target: { files: [csvFile("today.csv", content)] } });
    expect(await within(dialog).findByText("today.csv")).toBeInTheDocument();
    expect(within(dialog).getByText(`${content.length} B`)).toBeInTheDocument();
    await waitFor(() => expect(importButton(dialog)).toBeEnabled());
    expect(importButton(dialog)).toHaveTextContent("Import 1 row");

    fireEvent.click(within(dialog).getByRole("button", { name: /remove today\.csv/i }));
    expect(within(dialog).queryByText("today.csv")).toBeNull();
    expect(importButton(dialog)).toBeDisabled();
  });

  it("accepts a dropped file", async () => {
    const dialog = await setup();
    const zone = (await within(dialog).findByText(/choose a csv file/i)).closest("label")!;
    const content = `order_id,carrier_code,tracking_number\n${ORDER},dhl,ZX-12345\n`;
    fireEvent.drop(zone, { dataTransfer: { files: [csvFile("dropped.csv", content)] } });
    expect(await within(dialog).findByText("dropped.csv")).toBeInTheDocument();
  });

  it("the hidden file input is tied to the drop-zone label (keyboard reachable)", async () => {
    const dialog = await setup();
    await within(dialog).findByText(/carrier codes/i);
    const input = fileInput(dialog);
    expect(input).toHaveClass("sr-only");
    expect(input).not.toHaveAttribute("tabindex", "-1");
    expect(input.closest("label")).toHaveClass("drop-zone");
  });

  it("closes on Escape", async () => {
    const dialog = await setup();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
