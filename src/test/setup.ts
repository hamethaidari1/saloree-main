import "@testing-library/jest-dom/vitest";
import { createI18n } from "@/i18n/instance";
import { englishResources } from "./i18n";

// Components render outside the app's I18nProvider in unit tests; react-i18next
// then uses this instance, so tests see the real English text.
createI18n("en", englishResources);

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

// Radix popovers measure their trigger; jsdom has no ResizeObserver.
if (!("ResizeObserver" in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
