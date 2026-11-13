import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { CountryList, DeliverTo } from "@/components/marketplace/header/country-picker";
import {
  COUNTRIES,
  COUNTRY_KEY,
  CountryProvider,
  parseCountryCode,
  useCountry,
  type CountryCode,
} from "@/lib/country";
import { readCountryCookie } from "@/lib/country-cookie";
import { renderWithRouter } from "./router-harness";

function Probe() {
  const { country, ready } = useCountry();
  return <output data-testid="probe">{ready ? (country?.code ?? "none") : "loading"}</output>;
}
const withProvider = (ui: ReactNode, initial: CountryCode | null = null) => (
  <CountryProvider initial={initial}>{ui}</CountryProvider>
);
const renderPicker = (initial: CountryCode | null = null) =>
  renderWithRouter(
    withProvider(
      <>
        <DeliverTo />
        <Probe />
      </>,
      initial,
    ),
  );
const trigger = () => screen.getByRole("button", { name: /deliver to/i });
const clearCookie = () => (document.cookie = "country=; Max-Age=0; Path=/");

beforeEach(() => {
  localStorage.clear();
  clearCookie();
});
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

  it("picking a country updates the header, saves it in the cookie and closes the picker", async () => {
    renderPicker();
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("none"));
    fireEvent.click(trigger());
    const panel = await screen.findByRole("dialog");
    const options = within(panel).getAllByRole("button");
    // Names come from Intl.DisplayNames in the active language (English here).
    const display = new Intl.DisplayNames(["en"], { type: "region" });
    expect(options.map((o) => o.textContent)).toEqual(
      COUNTRIES.map((c) => (c.code === "OTHER" ? "Other" : display.of(c.code))),
    );

    fireEvent.click(within(panel).getByRole("button", { name: "Germany" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger()).toHaveTextContent("Germany");
    expect(trigger()).toHaveAccessibleName(/Deliver to Germany/);
    expect(screen.getByTestId("probe")).toHaveTextContent("DE");
    expect(readCountryCookie(document.cookie)).toBe("DE");

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
    renderWithRouter(withProvider(<DeliverTo variant="strip" />, "TR"));
    await waitFor(() =>
      expect(trigger()).toHaveTextContent(
        `Deliver to ${new Intl.DisplayNames(["en"], { type: "region" }).of("TR")}`,
      ),
    );
    fireEvent.click(trigger());
    const panel = await screen.findByRole("dialog");
    fireEvent.click(within(panel).getByRole("button", { name: "Finland" }));
    await waitFor(() => expect(trigger()).toHaveTextContent("Deliver to Finland"));
    expect(readCountryCookie(document.cookie)).toBe("FI");
  });

  it("the saved choice (read by the server) is shown from the first render — no flash", async () => {
    renderPicker("SE");
    expect(await screen.findByRole("button", { name: /deliver to sweden/i })).toBeTruthy();
  });

  it("moves a choice saved by an older version (localStorage) into the cookie, once", async () => {
    localStorage.setItem(COUNTRY_KEY, "NL");
    renderPicker();
    await waitFor(() => expect(trigger()).toHaveTextContent("Netherlands"));
    expect(readCountryCookie(document.cookie)).toBe("NL");
    expect(localStorage.getItem(COUNTRY_KEY)).toBeNull();
  });

  it("a cookie choice wins over an old localStorage value", async () => {
    localStorage.setItem(COUNTRY_KEY, "NL");
    renderPicker("FR");
    await waitFor(() => expect(localStorage.getItem(COUNTRY_KEY)).toBeNull());
    expect(trigger()).toHaveTextContent("France");
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
      withProvider(
        <>
          <CountryList />
          <Probe />
        </>,
      ),
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
