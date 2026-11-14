/**
 * Seller verification: the pure rules (no network, no React), shared by the
 * form, the service and the tests. Messages never contain the value typed:
 * these fields are sensitive (ID and tax numbers, date of birth).
 */
import { z } from "zod";
import { isIsoCountry } from "./iso-countries";

export const VERIFICATION_STATUSES = [
  "draft",
  "submitted",
  "needs_changes",
  "approved",
  "rejected",
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];
/** The seller may edit (and upload) only in these. */
export const EDITABLE_STATUSES: readonly VerificationStatus[] = [
  "draft",
  "needs_changes",
  "rejected",
];
export const isEditable = (s: VerificationStatus) => EDITABLE_STATUSES.includes(s);

export const STATUS_LABEL: Record<VerificationStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  needs_changes: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
};

export const SELLER_TYPES = ["individual", "business"] as const;
export type SellerType = (typeof SELLER_TYPES)[number];

export const ID_DOC_TYPES = [
  "passport",
  "national_id",
  "residence_permit",
  "driving_licence",
] as const;
export type IdDocType = (typeof ID_DOC_TYPES)[number];
export const ID_DOC_LABEL: Record<IdDocType, string> = {
  passport: "Passport",
  national_id: "National ID card",
  residence_permit: "Residence permit",
  driving_licence: "Driving licence",
};

export const DOCUMENT_KINDS = [
  "id_document",
  "id_document_back",
  "company_registration",
  "proof_of_address",
  "other",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
export const DOCUMENT_LABEL: Record<DocumentKind, string> = {
  id_document: "ID document",
  id_document_back: "ID document (back side)",
  company_registration: "Company registration",
  proof_of_address: "Proof of address",
  other: "Other document",
};

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
export const DOCUMENTS_BUCKET = "seller-documents";
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const MAX_DOCUMENTS = 10;
export const DOCUMENT_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type DocumentMime = (typeof DOCUMENT_MIME_TYPES)[number];
const EXTENSIONS: Record<DocumentMime, readonly string[]> = {
  "application/pdf": ["pdf"],
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
};
/** For <input accept>. */
export const DOCUMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

/** Why a file can't be uploaded, or null. Never mentions the file's content. */
export function documentFileProblem(
  file: { name: string; type: string; size: number },
  alreadyUploaded: number,
): string | null {
  if (alreadyUploaded >= MAX_DOCUMENTS)
    return `You can upload at most ${MAX_DOCUMENTS} files. Remove one to add another.`;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = DOCUMENT_MIME_TYPES.find((m) => m === file.type);
  if (!mime || !EXTENSIONS[mime].includes(ext))
    return "Only PDF, JPG and PNG files can be uploaded.";
  if (file.size <= 0) return "This file is empty.";
  if (file.size > MAX_DOCUMENT_BYTES) return "Files can be at most 5 MB.";
  return null;
}

/**
 * "Passeport Müller (1).PDF" → "passeport-muller-1.pdf": ASCII letters,
 * digits, "-" and one "." before the extension; at most 80 characters.
 */
export function safeFileName(name: string): string {
  const parts = name.trim().split(".");
  const ext =
    parts.length > 1
      ? parts
          .pop()!
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "")
      : "";
  const base = parts
    .join(".")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${base || "document"}${ext ? `.${ext.slice(0, 8)}` : ""}`;
}

/** `<user_id>/<uuid>-<safe-file-name>`: the only path the storage rules accept. */
export function documentPath(userId: string, fileName: string, uuid: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("A signed-in user is needed to upload.");
  return `${userId}/${uuid}-${safeFileName(fileName)}`;
}

export const formatBytes = (n: number) =>
  n >= 1024 * 1024
    ? `${(n / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;

// ---------------------------------------------------------------------------
// Masking
// ---------------------------------------------------------------------------
/** "AB1234567" → "•••••4567": only the last `keep` characters (3 for short values). */
export function maskValue(value: string | null | undefined, keep = 4): string {
  const v = (value ?? "").replace(/\s+/g, "");
  if (!v) return "—";
  const shown = v.length <= keep + 2 ? Math.min(3, Math.max(0, v.length - 3)) : keep;
  return `${"•".repeat(Math.max(3, v.length - shown))}${shown ? v.slice(-shown) : ""}`;
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------
export interface VerificationForm {
  seller_type: SellerType | "";
  full_name: string;
  birth_date: string;
  id_doc_type: IdDocType | "";
  id_doc_number: string;
  id_doc_country: string;
  company_name: string;
  company_reg_number: string;
  company_country: string;
  tax_country: string;
  tin: string;
  vat_number: string;
  country: string;
  address_line1: string;
  address_line2: string;
  city: string;
  postal_code: string;
  phone: string;
  contact_email: string;
  main_category: string;
  product_summary: string;
  ships_to: string[];
  ship_from_country: string;
  ship_from_city: string;
  declared_truthful: boolean;
  declared_lawful_goods: boolean;
  declared_independent: boolean;
}
export type FormField = keyof VerificationForm;

export const EMPTY_FORM: VerificationForm = {
  seller_type: "",
  full_name: "",
  birth_date: "",
  id_doc_type: "",
  id_doc_number: "",
  id_doc_country: "",
  company_name: "",
  company_reg_number: "",
  company_country: "",
  tax_country: "",
  tin: "",
  vat_number: "",
  country: "",
  address_line1: "",
  address_line2: "",
  city: "",
  postal_code: "",
  phone: "",
  contact_email: "",
  main_category: "",
  product_summary: "",
  ships_to: [],
  ship_from_country: "",
  ship_from_city: "",
  declared_truthful: false,
  declared_lawful_goods: false,
  declared_independent: false,
};

export const MIN_SELLER_AGE = 18;

/** Whole years between a YYYY-MM-DD birth date and `now` (UTC). */
export function ageOn(birth: string, now: Date): number {
  const [y, m, d] = birth.split("-").map(Number) as [number, number, number];
  let age = now.getUTCFullYear() - y;
  const md = (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
  if (md < m * 100 + d) age--;
  return age;
}

const realDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === s;
};

/** "+93 70-123 (4567)" → "+93701234567". */
export const normalizePhone = (s: string) => s.replace(/[\s().-]/g, "");

const COUNTRY_MSG = "Choose a country from the list.";
const text = (min: number, max: number, what: string) =>
  z
    .string()
    .trim()
    .max(max, `${what} can be at most ${max} characters.`)
    .refine((v) => v === "" || v.length >= min, `${what} is too short.`);
const code = z.string().refine((v) => v === "" || isIsoCountry(v), COUNTRY_MSG);
const reference = (max: number, what: string) =>
  z
    .string()
    .trim()
    .max(max, `${what} can be at most ${max} characters.`)
    .refine(
      (v) => v === "" || /^[A-Za-z0-9][A-Za-z0-9 ./-]*$/.test(v),
      `${what} can contain only letters, digits, spaces, "-", "/" and ".".`,
    );

/** Format rules: an empty field always passes (a draft may be incomplete). */
const formatSchema = (now: Date) =>
  z.object({
    seller_type: z.enum(["", ...SELLER_TYPES]),
    full_name: text(2, 120, "The name").refine(
      (v) => v === "" || /\p{L}/u.test(v),
      "Enter the name as it is written on the ID.",
    ),
    birth_date: z.string().refine((v) => {
      if (v === "") return true;
      return realDate(v) && v <= now.toISOString().slice(0, 10);
    }, "Enter a real date of birth."),
    id_doc_type: z.enum(["", ...ID_DOC_TYPES]),
    id_doc_number: reference(40, "The document number").refine(
      (v) => v === "" || v.replace(/[^A-Za-z0-9]/g, "").length >= 4,
      "The document number is too short.",
    ),
    id_doc_country: code,
    company_name: text(2, 160, "The company name"),
    company_reg_number: reference(40, "The registration number").refine(
      (v) => v === "" || v.replace(/[^A-Za-z0-9]/g, "").length >= 2,
      "The registration number is too short.",
    ),
    company_country: code,
    tax_country: code,
    tin: reference(30, "The tax number"),
    vat_number: z
      .string()
      .trim()
      .refine(
        (v) => v === "" || /^[A-Za-z0-9]{4,20}$/.test(v.replace(/[\s.-]/g, "")),
        "A VAT number has 4 to 20 letters and digits.",
      ),
    country: code,
    address_line1: text(2, 160, "The street address"),
    address_line2: text(1, 160, "Address line 2"),
    city: text(2, 80, "The city"),
    postal_code: z
      .string()
      .trim()
      .refine(
        (v) => v === "" || /^[A-Za-z0-9][A-Za-z0-9 -]{1,15}$/.test(v),
        "Enter a valid postal code.",
      ),
    phone: z
      .string()
      .refine(
        (v) => v.trim() === "" || /^\+[1-9]\d{6,14}$/.test(normalizePhone(v)),
        "Enter the number with + and the country code.",
      ),
    contact_email: z
      .string()
      .trim()
      .max(254, "The e-mail address is too long.")
      .refine(
        (v) => v === "" || z.string().email().safeParse(v).success,
        "Enter a valid e-mail address.",
      ),
    main_category: text(1, 80, "The category"),
    product_summary: text(20, 1000, "The description"),
    ships_to: z
      .array(z.string())
      .max(ISO_MAX, "Too many countries.")
      .refine((a) => a.every(isIsoCountry), COUNTRY_MSG)
      .refine((a) => new Set(a).size === a.length, "Each country only once."),
    ship_from_country: code,
    ship_from_city: text(2, 80, "The city"),
    declared_truthful: z.boolean(),
    declared_lawful_goods: z.boolean(),
    declared_independent: z.boolean(),
  });
const ISO_MAX = 249;

const REQUIRED: Partial<Record<FormField, string>> = {
  seller_type: "Choose how you sell.",
  full_name: "Enter your full name.",
  country: "Choose your country.",
  address_line1: "Enter your street address.",
  city: "Enter your city.",
  phone: "Enter a phone number.",
  contact_email: "Enter an e-mail address.",
  main_category: "Choose a category.",
  product_summary: "Describe what you sell.",
  ship_from_country: "Choose the country you ship from.",
  ship_from_city: "Enter the city you ship from.",
  ships_to: "Choose at least one country you ship to.",
  declared_truthful: "Please confirm this to continue.",
  declared_lawful_goods: "Please confirm this to continue.",
  declared_independent: "Please confirm this to continue.",
};
const REQUIRED_INDIVIDUAL: Partial<Record<FormField, string>> = {
  birth_date: "Enter your date of birth.",
  id_doc_type: "Choose the type of ID document.",
  id_doc_number: "Enter the document number.",
  id_doc_country: "Choose the country that issued it.",
};
const REQUIRED_BUSINESS: Partial<Record<FormField, string>> = {
  full_name: "Enter the representative's full name.",
  company_name: "Enter the company name.",
  company_reg_number: "Enter the registration number.",
  company_country: "Choose the country of registration.",
};

const isEmpty = (v: unknown) =>
  v === "" || v === false || (Array.isArray(v) && v.length === 0) || v == null;

export type FieldErrors = Partial<Record<FormField, string>>;

/**
 * Inline messages for the form. "draft" checks only the format of what was
 * entered; "complete" also requires every field the seller type needs, and
 * that an individual is at least 18.
 */
export function validateForm(
  values: VerificationForm,
  mode: "draft" | "complete",
  now: Date = new Date(),
): FieldErrors {
  const errors: FieldErrors = {};
  const parsed = formatSchema(now).safeParse(values);
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const f = issue.path[0] as FormField;
      errors[f] ??= issue.message;
    }
  const type = values.seller_type;
  if (
    type === "individual" &&
    values.birth_date &&
    !errors.birth_date &&
    realDate(values.birth_date)
  )
    if (ageOn(values.birth_date, now) < MIN_SELLER_AGE)
      errors.birth_date = `You must be at least ${MIN_SELLER_AGE} years old to sell.`;
  if (mode === "draft") return errors;
  const required = {
    ...REQUIRED,
    ...(type === "individual" ? REQUIRED_INDIVIDUAL : {}),
    ...(type === "business" ? REQUIRED_BUSINESS : {}),
  };
  for (const [f, msg] of Object.entries(required) as [FormField, string][])
    if (!errors[f] && isEmpty(values[f])) errors[f] = msg;
  return errors;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------
export const STEPS = [
  { id: "type", label: "Seller type", fields: ["seller_type"] },
  {
    id: "identity",
    label: "Identity",
    fields: [
      "full_name",
      "birth_date",
      "id_doc_type",
      "id_doc_number",
      "id_doc_country",
      "company_name",
      "company_reg_number",
      "company_country",
    ],
  },
  {
    id: "address",
    label: "Address and contact",
    fields: [
      "country",
      "address_line1",
      "address_line2",
      "city",
      "postal_code",
      "phone",
      "contact_email",
    ],
  },
  { id: "tax", label: "Tax", fields: ["tax_country", "tin", "vat_number"] },
  {
    id: "shop",
    label: "Your shop",
    fields: ["main_category", "product_summary", "ship_from_country", "ship_from_city", "ships_to"],
  },
  { id: "documents", label: "Documents", fields: [] },
  {
    id: "review",
    label: "Declarations and review",
    fields: ["declared_truthful", "declared_lawful_goods", "declared_independent"],
  },
] as const satisfies readonly { id: string; label: string; fields: readonly FormField[] }[];
export type StepId = (typeof STEPS)[number]["id"];

export const stepErrors = (step: StepId, errors: FieldErrors): FieldErrors => {
  const fields: readonly FormField[] = STEPS.find((s) => s.id === step)!.fields;
  return Object.fromEntries(
    Object.entries(errors).filter(([f]) => fields.includes(f as FormField)),
  ) as FieldErrors;
};

/** The documents a seller type must upload. */
export const requiredDocuments = (type: SellerType | ""): DocumentKind[] =>
  type === "business" ? ["id_document", "company_registration"] : ["id_document"];

export const missingDocuments = (type: SellerType | "", kinds: readonly string[]) =>
  requiredDocuments(type).filter((k) => !kinds.includes(k));

/**
 * Whether a step is complete. Nothing counts before the seller type is chosen
 * (the Tax step has no required field, but isn't "done" for a new seller).
 */
export function stepComplete(
  step: StepId,
  values: VerificationForm,
  documentKinds: readonly string[],
  now: Date = new Date(),
): boolean {
  if (step === "review") return false;
  if (step !== "type" && !values.seller_type) return false;
  if (step === "documents") return missingDocuments(values.seller_type, documentKinds).length === 0;
  return Object.keys(stepErrors(step, validateForm(values, "complete", now))).length === 0;
}

/** Where to resume: the first step that isn't complete yet (else the review). */
export function resumeStep(
  values: VerificationForm,
  documentKinds: readonly string[],
  now: Date = new Date(),
): StepId {
  const errors = validateForm(values, "complete", now);
  for (const step of STEPS) {
    if (step.id === "review") break;
    if (step.id === "documents") {
      if (missingDocuments(values.seller_type, documentKinds).length) return "documents";
      continue;
    }
    if (Object.keys(stepErrors(step.id, errors)).length) return step.id;
  }
  return "review";
}
