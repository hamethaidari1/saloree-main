import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import {
  countryByCode,
  deliveryCountryForIso,
  parseCountryCode,
  type Country,
  type CountryCode,
  type DeliveryCountryCode,
} from "./countries";
import { saveCountryCookie } from "./country-request";

export {
  COUNTRIES,
  countryByCode,
  parseCountryCode,
  type Country,
  type CountryCode,
} from "./countries";

/** Where older versions kept the choice; moved into the `country` cookie once. */
export const COUNTRY_KEY = "saloree-country-v1";

interface CountryContextValue {
  /** null until the visitor picks one. */
  country: Country | null;
  setCountry: (code: CountryCode) => void;
  /** The detected country when it is one of ours (for the "Deliver to …?" offer). */
  detected: DeliveryCountryCode | null;
  /** true once the saved choice is known (immediately: the server read the cookie). */
  ready: boolean;
}
const CountryContext = createContext<CountryContextValue | undefined>(undefined);

export function CountryProvider({
  children,
  initial = null,
  detected = null,
}: {
  children: ReactNode;
  /** The `country` cookie as the server read it (so the first HTML already shows it). */
  initial?: CountryCode | null;
  /** ISO code from the hosting header (server) or the dev override. */
  detected?: string | null;
}) {
  const [code, setCode] = useState<CountryCode | null>(initial);

  const setCountry = useCallback((next: CountryCode) => {
    if (!parseCountryCode(next)) return;
    setCode(next);
    try {
      saveCountryCookie(next);
    } catch {
      /* Cookies unavailable: keep the in-memory choice. */
    }
  }, []);

  // One-time move of a choice saved by an older version (localStorage → cookie),
  // so the server can read it from now on. After hydration only.
  useEffect(() => {
    let legacy: CountryCode | null = null;
    try {
      legacy = parseCountryCode(localStorage.getItem(COUNTRY_KEY));
      localStorage.removeItem(COUNTRY_KEY);
    } catch {
      /* Storage unavailable: nothing to move. */
    }
    if (legacy && !initial) setCountry(legacy);
  }, [initial, setCountry]);

  return (
    <CountryContext.Provider
      value={{
        country: countryByCode(code),
        setCountry,
        detected: deliveryCountryForIso(detected),
        ready: true,
      }}
    >
      {children}
    </CountryContext.Provider>
  );
}

export function useCountry() {
  const context = useContext(CountryContext);
  if (!context) throw new Error("CountryProvider is required");
  return context;
}
