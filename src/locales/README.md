# Translations

Customer-facing text for Saloree, one folder per language, one JSON file per area
(`common`, `nav`, `home`, `product`, `cart`, `checkout`, `account`, `auth`, `footer`,
`errors`, `categories`, `orders`, `store`). English (`en`) is the source.

> **Status:** every language except English was machine-written and has **not** been
> reviewed by a native speaker (`meta.json` → `"reviewed": false`). Have each one
> reviewed before launch, then set `reviewed: true`, `reviewedBy` and `reviewedAt`.
> `meta.json` is for the team only — it is never sent to the browser.

## Adding a language (e.g. Persian `fa`, Pashto `ps`)

1. Copy `en/` to a new folder named with the language code, e.g. `fa/`, and translate the values.
2. Add one entry to `LOCALES` in `src/i18n/locales.ts`, e.g.
   `{ code: "fa", nativeName: "فارسی", dir: "rtl", match: ["fa"] }`.
3. Run `npm run i18n:check` and fix what it reports (plural forms differ per language).

Nothing else changes: loading, `<html lang dir>`, the language menu and RTL layout follow
from that entry.

## Rules (checked by `npm run i18n:check`, also run in the test suite)

- Same keys as English; no empty values.
- Keep `{{placeholders}}` exactly as in English (they may move within the sentence).
- Keep `<1>…</1>` / `<3>…</3>` tags: they wrap links or bold text. Translate the text
  inside, keep the numbers.
- Plural keys (`key_one`, `key_other`, …) must have exactly the forms the language uses:
  English/German `one, other` · Spanish/Portuguese `one, many, other` ·
  Hebrew `one, two, other` · Arabic `zero, one, two, few, many, other` ·
  Korean/Chinese `other` only. A form may spell the number out instead of `{{count}}`
  (e.g. Arabic `عنصر واحد`).
- Never translate: the brand **Saloree**, **Google**, **Stripe**, **HesabPay**, **USD**.
- Not in these files (shown as written): product titles/descriptions, store names and
  descriptions, tracking notes. Category names are translated by slug in
  `categories.json`; a new category shows its database name until it is added there.

## Review checklist (per language)

For every language, the reviewer checks:

- [ ] Tone: friendly, short, consistent form of address (see notes below).
- [ ] Buttons and menu items are short enough for a phone (360 px wide).
- [ ] Plural sentences read naturally for 0, 1, 2, 3, 11 and 100 items.
- [ ] Checkout and address labels use the terms people expect on a shop.
- [ ] Order statuses and delivery steps match local shipping vocabulary.
- [ ] Error messages are clear and polite; none blame the shopper.
- [ ] Legal/business terms (`footer.businessId`) use the right local term.
- [ ] Page titles and descriptions (`meta`) read well in search results.

Language-specific notes:

| Code | Language | Written as | Check especially |
|---|---|---|---|
| es | Español | neutral Spanish, `tú` | Spain vs Latin America terms (e.g. "carrito", "envío") |
| ar | العربية | Modern Standard Arabic, masculine generic imperatives | all six plural forms; whether a gender-neutral style is preferred |
| de | Deutsch | informal `du` | `du` vs `Sie` for the brand; long compound words on buttons |
| he | עברית | gender-neutral infinitives | plural `two` forms; quotation marks |
| ko | 한국어 | polite 합니다/해요 | consistency of 합니다 vs 해요 |
| pt | Português | Brazilian, `você` | whether European Portuguese (pt-PT) needs its own folder |
| zh-Hans | 中文(简体) | mainland vocabulary | 账号/登录 terms, punctuation |
| zh-Hant | 中文(繁體) | Taiwan vocabulary (not converted from Simplified) | Hong Kong terms if HK is a target market; 統一編號 for business ID |
