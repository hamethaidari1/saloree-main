import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CountryList, DeliverTo } from "@/components/marketplace/header/country-picker";
import {
  COUNTRIES,
  COUNTRY_KEY,
  CountryProvider,
  parseCountryCode,
  useCountry,
} from "@/lib/country";

function Probe() {
  const { country, ready } = useCountry();
  return <output data-testid="probe">{ready ? (country?.code ?? "none") : "loading"}</output>;
}
const renderPicker = () =>
  render(
    <CountryProvider>
      <DeliverTo />
      <Probe />
    </CountryProvider>,
  );
const trigger = () => screen.getByRole("button", { name: /deliver to/i });

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("country list", () => {
  it("offers the agreed countries in order, ending with Other", () => {
    expect(COUNTRIES.map((c) => c.name)).toEqual([
      "Afghanistan",
      "Finland",
      "Germany",
      "France",
      "Sweden",
      "Netherlands",
      "Turkey",
      "United Kingdom",
      "Other",
    ]);
  });
  it("only accepts known codes from storage", () => {
    expect(parseCountryCode("DE")).toBe("DE");
    expect(parseCountryCode("de")).toBeNull();
    expect(parseCountryCode("XX")).toBeNull();
    expect(parseCountryCode(null)).toBeNull();
  });
});

describe("Deliver to picker", () => {
  it("starts with no country and asks the visitor to choose", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("none"));
    expect(trigger()).toHaveTextContent("Choose country");
  });

  it("picking a country updates the header, saves it and closes the picker", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("none"));
    fireEvent.click(trigger());
    const panel = await screen.findByRole("dialog");
    const options = within(panel).getAllByRole("button");
    expect(options.map((o) => o.textContent)).toEqual(COUNTRIES.map((c) => c.name));

    fireEvent.click(within(panel).getByRole("button", { name: "Germany" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger()).toHaveTextContent("Germany");
    expect(trigger()).toHaveAccessibleName(/Deliver to Germany/);
    expect(screen.getByTestId("probe")).toHaveTextContent("DE");
    expect(localStorage.getItem(COUNTRY_KEY)).toBe("DE");

    fireEvent.click(trigger());
    const reopened = await screen.findByRole("dialog");
    expect(within(reopened).getByRole("button", { name: "Germany" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(reopened).getByRole("button", { name: "France" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("mobile strip shows 'Deliver to <country>' on one line and opens the same picker", async () => {
    localStorage.setItem(COUNTRY_KEY, "TR");
    render(
      <CountryProvider>
        <DeliverTo variant="strip" />
      </CountryProvider>,
    );
    await waitFor(() => expect(trigger()).toHaveTextContent("Deliver to Turkey"));
    fireEvent.click(trigger());
    const panel = await screen.findByRole("dialog");
    fireEvent.click(within(panel).getByRole("button", { name: "Finland" }));
    await waitFor(() => expect(trigger()).toHaveTextContent("Deliver to Finland"));
    expect(localStorage.getItem(COUNTRY_KEY)).toBe("FI");
  });

  it("restores a saved country after mount", async () => {
    localStorage.setItem(COUNTRY_KEY, "SE");
    renderPicker();
    await waitFor(() => expect(trigger()).toHaveTextContent("Sweden"));
  });

  it("ignores a corrupted saved value", async () => {
    localStorage.setItem(COUNTRY_KEY, '{"hack":true}');
    renderPicker();
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("none"));
  });

  it("keeps working when storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(
      <CountryProvider>
        <CountryList />
        <Probe />
      </CountryProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("none"));
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    expect(screen.getByTestId("probe")).toHaveTextContent("OTHER");
  });

  it("useCountry outside the provider is a clear error", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/CountryProvider is required/);
  });
});
