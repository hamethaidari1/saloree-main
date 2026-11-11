import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/** Delivery countries, in display order. "Other" covers everywhere else. */
export const COUNTRIES = [
  { code: "AF", name: "Afghanistan" },
  { code: "FI", name: "Finland" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
  { code: "SE", name: "Sweden" },
  { code: "NL", name: "Netherlands" },
  { code: "TR", name: "Turkey" },
  { code: "GB", name: "United Kingdom" },
  { code: "OTHER", name: "Other" },
] as const;
export type Country = (typeof COUNTRIES)[number];
export type CountryCode = Country["code"];

export const COUNTRY_KEY = "saloree-country-v1";

/** Only known codes are accepted from storage. */
export function parseCountryCode(value: unknown): CountryCode | null {
  return COUNTRIES.find((c) => c.code === value)?.code ?? null;
}
export const countryByCode = (code: CountryCode | null) =>
  COUNTRIES.find((c) => c.code === code) ?? null;

interface CountryContextValue {
  /** null until the visitor picks one. */
  country: Country | null;
  setCountry: (code: CountryCode) => void;
  /** false until the saved choice has been read (after hydration). */
  ready: boolean;
}
const CountryContext = createContext<CountryContextValue | undefined>(undefined);

export function CountryProvider({ children }: { children: ReactNode }) {
  const [code, setCode] = useState<CountryCode | null>(null);
  const [ready, setReady] = useState(false);

  // Restore after hydration so server and client render the same markup first.
  useEffect(() => {
    try {
      setCode(parseCountryCode(localStorage.getItem(COUNTRY_KEY)));
    } catch {
      /* Storage unavailable: the choice lives in memory only. */
    }
    setReady(true);
  }, []);

  const setCountry = useCallback((next: CountryCode) => {
    if (!parseCountryCode(next)) return;
    setCode(next);
    try {
      localStorage.setItem(COUNTRY_KEY, next);
    } catch {
      /* Storage unavailable: keep the in-memory choice. */
    }
  }, []);

  return (
    <CountryContext.Provider value={{ country: countryByCode(code), setCountry, ready }}>
      {children}
    </CountryContext.Provider>
  );
}

export function useCountry() {
  const context = useContext(CountryContext);
  if (!context) throw new Error("CountryProvider is required");
  return context;
}
