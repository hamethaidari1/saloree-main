import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CustomerTracking } from "@/components/tracking/customer-tracking";
import { OrderProgress, TrackLink } from "@/components/tracking/tracking-ui";
import {
  buildTrackingUrl,
  fillTrackingTemplate,
  safeHttpsUrl,
  sortEvents,
  trackingProgress,
} from "@/lib/tracking";

describe("safeHttpsUrl", () => {
  it.each([
    ["https://track.example/x?n=1", "https://track.example/x?n=1"],
    ["  https://track.example/x ", "https://track.example/x"],
    ["HTTPS://Track.Example/x", "https://track.example/x"],
  ])("accepts %j", (input, out) => expect(safeHttpsUrl(input)).toBe(out));
  it.each([
    "javascript:alert(1)",
    " javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "http://track.example/x",
    "//track.example/x",
    "/relative",
    "https://",
    "",
    null,
    undefined,
  ])("rejects %j", (input) => expect(safeHttpsUrl(input)).toBeNull());
});

describe("tracking links", () => {
  const carrier = { tracking_url_template: "https://carrier.example/track?n={number}" };
  it("fills the template and URL-encodes the number", () => {
    expect(fillTrackingTemplate(carrier.tracking_url_template, "AB 12/3&x")).toBe(
      "https://carrier.example/track?n=AB%2012%2F3%26x",
    );
  });
  it("replaces every placeholder", () =>
    expect(fillTrackingTemplate("https://c.example/{number}?q={number}", "Z9")).toBe(
      "https://c.example/Z9?q=Z9",
    ));
  it("refuses templates without the placeholder or that aren't https", () => {
    expect(fillTrackingTemplate("https://c.example/track", "1")).toBeNull();
    expect(fillTrackingTemplate("http://c.example/{number}", "1")).toBeNull();
    expect(fillTrackingTemplate("javascript:alert('{number}')", "1")).toBeNull();
    expect(fillTrackingTemplate(null, "1")).toBeNull();
  });
  it("prefers the shipment's own https link, else the carrier template", () => {
    expect(
      buildTrackingUrl({ tracking_url: "https://own.example/1", tracking_number: "1234" }, carrier),
    ).toBe("https://own.example/1");
    expect(buildTrackingUrl({ tracking_url: null, tracking_number: "1234" }, carrier)).toBe(
      "https://carrier.example/track?n=1234",
    );
  });
  it("an unsafe custom link falls back to the template, never to the unsafe link", () => {
    expect(
      buildTrackingUrl({ tracking_url: "javascript:alert(1)", tracking_number: "1234" }, carrier),
    ).toBe("https://carrier.example/track?n=1234");
    expect(
      buildTrackingUrl({ tracking_url: "javascript:alert(1)", tracking_number: "1234" }, null),
    ).toBeNull();
  });
});

describe("TrackLink", () => {
  it("opens the carrier page in a new tab safely", () => {
    render(
      <TrackLink
        shipment={{ tracking_url: null, tracking_number: "1234" }}
        carrier={{ tracking_url_template: "https://c.example/{number}" }}
      />,
    );
    const a = screen.getByRole("link", { name: /track/i });
    expect(a).toHaveAttribute("href", "https://c.example/1234");
    expect(a).toHaveAttribute("target", "_blank");
    expect(a).toHaveAttribute("rel", "noopener noreferrer");
  });
  it.each(["javascript:alert(1)", "http://c.example/1", "data:text/html,x"])(
    "renders nothing for %j",
    (url) => {
      const { container } = render(
        <TrackLink shipment={{ tracking_url: url, tracking_number: "1234" }} carrier={null} />,
      );
      expect(container.querySelector("a")).toBeNull();
    },
  );
});

describe("sortEvents", () => {
  it("newest first, stable for ties", () => {
    const e = [
      { id: "a", occurred_at: "2026-11-10T10:00:00Z" },
      { id: "b", occurred_at: "2026-11-12T10:00:00Z" },
      { id: "c", occurred_at: "2026-11-12T10:00:00Z" },
    ];
    expect(sortEvents(e).map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
});

describe("trackingProgress", () => {
  const cur = (order: string, ...statuses: string[]) =>
    trackingProgress(
      order,
      statuses.map((status) => ({ status })),
    ).current;
  it("follows the order and shipment status", () => {
    expect(cur("pending")).toBe("placed");
    expect(cur("processing")).toBe("processing");
    expect(cur("pending", "label_created")).toBe("processing");
    expect(cur("shipped", "in_transit")).toBe("shipped");
    expect(cur("shipped", "out_for_delivery")).toBe("out_for_delivery");
    expect(cur("delivered", "delivered")).toBe("delivered");
  });
  it("with several packages, the least advanced one counts", () => {
    expect(cur("shipped", "delivered", "in_transit")).toBe("shipped");
  });
  it("marks earlier steps done and later ones upcoming", () => {
    const p = trackingProgress("shipped", [{ status: "in_transit" }]);
    expect(p.steps.map((s) => s.state)).toEqual([
      "done",
      "done",
      "current",
      "upcoming",
      "upcoming",
    ]);
    expect(trackingProgress("delivered", [{ status: "delivered" }]).steps.at(-1)?.state).toBe(
      "done",
    );
  });
  it("flags problems and cancellation", () => {
    expect(trackingProgress("shipped", [{ status: "exception" }]).alert).toBe("exception");
    expect(trackingProgress("shipped", [{ status: "returned" }]).alert).toBe("returned");
    expect(trackingProgress("cancelled", []).alert).toBe("cancelled");
    expect(trackingProgress("shipped", [{ status: "in_transit" }]).alert).toBeNull();
  });
});

describe("customer tracking UI", () => {
  it("shows the empty state before anything ships", () => {
    render(<CustomerTracking orderStatus="pending" shipments={[]} loading={false} error={null} />);
    expect(screen.getByText("Your order has not shipped yet.")).toBeInTheDocument();
  });
  it("shows the real error when tracking can't load", () => {
    render(
      <CustomerTracking
        orderStatus="pending"
        shipments={[]}
        loading={false}
        error={{ code: "PGRST205", message: "Could not find the table 'public.shipments'" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("public.shipments");
  });
  it("marks the current step and shows exceptions clearly", () => {
    render(<OrderProgress orderStatus="shipped" shipments={[{ status: "exception" }]} />);
    expect(screen.getByText(/Shipped/).closest("li")).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("status")).toHaveTextContent(/problem with the delivery/);
  });
  it("lists shipments with events and the track button", () => {
    render(
      <CustomerTracking
        orderStatus="shipped"
        loading={false}
        error={null}
        shipments={[
          {
            id: "s1",
            order_id: "o1",
            carrier_id: "c1",
            carrier_name: null,
            tracking_number: "ZX12345",
            tracking_url: null,
            status: "in_transit",
            shipped_at: null,
            delivered_at: null,
            created_at: "",
            updated_at: "",
            carriers: {
              id: "c1",
              code: "dhl",
              name: "DHL",
              tracking_url_template: "https://dhl.example/{number}",
              is_active: true,
            },
            shipment_events: [
              {
                id: "e1",
                shipment_id: "s1",
                status: "in_transit",
                description: "Left the warehouse",
                location: "Kabul",
                source: "seller",
                occurred_at: "2026-11-12T08:00:00Z",
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText("DHL")).toBeInTheDocument();
    expect(screen.getByText("Left the warehouse")).toBeInTheDocument();
    expect(screen.getByText("Kabul")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /track your shipment/i })).toHaveAttribute(
      "href",
      "https://dhl.example/ZX12345",
    );
  });
});
