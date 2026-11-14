/**
 * Payment logos in the footer, shown only while card payments (Stripe) are on.
 * The files are supplied by the owner in public/payment-logos/ (see the README
 * there) and used as they are: never edited, redrawn or fetched from elsewhere.
 * Exactly these six; add a brand here only when it is really accepted.
 */
export const PAYMENT_BRANDS = [
  { id: "visa", name: "Visa", file: "visa.png" },
  { id: "mastercard", name: "Mastercard", file: "mastercard.png" },
  { id: "maestro", name: "Maestro", file: "maestro.png" },
  { id: "amex", name: "American Express", file: "amex.png" },
  { id: "apple-pay", name: "Apple Pay", file: "apple-pay.png" },
  { id: "google-pay", name: "Google Pay", file: "google-pay.png" },
] as const;

export type PaymentBrand = (typeof PAYMENT_BRANDS)[number];

/** The supplied files' size (about 60×50 px); the browser keeps each file's real ratio. */
export const LOGO_FILE_WIDTH = 60;
export const LOGO_FILE_HEIGHT = 50;

export const logoSrc = (b: PaymentBrand) => `/payment-logos/${b.file}`;
