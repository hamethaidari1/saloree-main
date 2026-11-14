# Payment logos

The footer shows these six logos only when card payments are on
(`VITE_STRIPE_ENABLED=true`). While a file is missing, the footer shows the brand
name as a plain text badge instead, so nothing breaks.

| File             | Shown as (alt text) |
| ---------------- | ------------------- |
| `visa.png`       | Visa                |
| `mastercard.png` | Mastercard          |
| `maestro.png`    | Maestro             |
| `amex.png`       | American Express    |
| `apple-pay.png`  | Apple Pay           |
| `google-pay.png` | Google Pay          |

Rules:

- Small PNGs with their own white background, about 60×50 px. Keep the exact file
  names above.
- The files are used as they are: the app never edits, recolours, stretches or redraws
  them. All six are shown at the same height (24 px); each keeps its own aspect ratio.
- They must be the brands' official artwork, used according to each brand's
  guidelines.
- Only brands that are really accepted belong here. Apple Pay and Google Pay must be
  switched on in the Stripe Dashboard (Settings > Payment methods) before going live.
  Do not add other brands (Discover, Diners, UnionPay, V Pay, contactless, PayPal,
  Klarna...) unless the app really accepts them and the code is updated too.
