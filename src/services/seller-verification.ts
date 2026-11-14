/**
 * Seller verification. The browser only SELECTs seller_profiles; every change
 * goes through an RPC (save_seller_profile, submit_seller_profile,
 * review_seller_profile). Documents live in the PRIVATE `seller-documents`
 * bucket and are opened through 60-second signed URLs only.
 *
 * Privacy: nothing here logs, and errors carry only the database's message
 * and code — never `details`/`hint` (Postgres puts the failing row's values
 * there) and never a value from the form.
 */
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import {
  DOCUMENT_KINDS,
  DOCUMENT_MIME_TYPES,
  DOCUMENTS_BUCKET,
  documentFileProblem,
  documentPath,
  EMPTY_FORM,
  ID_DOC_TYPES,
  normalizePhone,
  safeFileName,
  SELLER_TYPES,
  VERIFICATION_STATUSES,
  type DocumentKind,
  type VerificationForm,
  type VerificationStatus,
} from "@/lib/seller-verification";

/** A database error reduced to what is safe to show: its message and code. */
export class VerificationDbError extends Error {
  constructor(
    message: string,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "VerificationDbError";
  }
}
const dbError = (e: { message?: string; code?: string } | null | undefined) =>
  new VerificationDbError(e?.message || "The database refused the request.", e?.code ?? null);

/** "message (code)" for screens. */
export function errorText(e: unknown): string {
  // Only message and code are read: never `details` or `hint`.
  const o = (e ?? {}) as { message?: unknown; code?: unknown };
  const message = typeof o.message === "string" ? o.message : "";
  if (!message) return "Something went wrong. Please try again.";
  return typeof o.code === "string" && o.code ? `${message} (${o.code})` : message;
}

class ShapeError extends Error {
  constructor(what: string, issues: z.ZodIssue[]) {
    // Field names only, never the values.
    const fields = [...new Set(issues.map((i) => i.path.join(".") || "(root)"))].join(", ");
    super(`${what} has unexpected values (${fields}).`);
    this.name = "ShapeError";
  }
}
function parse<T extends z.ZodTypeAny>(schema: T, data: unknown, what: string): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) throw new ShapeError(what, r.error.issues);
  return r.data;
}

async function requireUserId() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in again.");
  return user.id;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------
const str = z
  .string()
  .nullish()
  .transform((v) => v ?? null);

export const sellerProfileSchema = z.object({
  user_id: z.string(),
  status: z.enum(VERIFICATION_STATUSES),
  seller_type: z
    .enum(SELLER_TYPES)
    .nullish()
    .transform((v) => v ?? null),
  full_name: str,
  birth_date: str.transform((v) => (v ? v.slice(0, 10) : null)),
  id_doc_type: z
    .enum(ID_DOC_TYPES)
    .nullish()
    .transform((v) => v ?? null),
  id_doc_number: str,
  id_doc_country: str,
  company_name: str,
  company_reg_number: str,
  company_country: str,
  tax_country: str,
  tin: str,
  vat_number: str,
  country: str,
  address_line1: str,
  address_line2: str,
  city: str,
  postal_code: str,
  phone: str,
  contact_email: str,
  main_category: str,
  product_summary: str,
  ships_to: z
    .array(z.string())
    .nullish()
    .transform((v) => v ?? []),
  ship_from_country: str,
  ship_from_city: str,
  declared_truthful_at: str,
  declared_lawful_goods_at: str,
  declared_independent_at: str,
  submitted_at: str,
  review_note: str,
  reviewed_by: str,
  reviewed_at: str,
  created_at: str,
  updated_at: str,
});
export type SellerProfile = z.output<typeof sellerProfileSchema>;

export const sellerDocumentSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  kind: z.enum(DOCUMENT_KINDS),
  path: z.string(),
  file_name: z.string(),
  mime_type: z.enum(DOCUMENT_MIME_TYPES),
  size_bytes: z.coerce.number().int().nonnegative(),
  created_at: str,
});
export type SellerDocument = z.output<typeof sellerDocumentSchema>;

/** The status of someone with no profile row yet. */
export const statusOf = (p: SellerProfile | null): VerificationStatus => p?.status ?? "draft";

/** A stored profile → form values ("" for empty). */
export function profileToForm(p: SellerProfile | null): VerificationForm {
  if (!p) return { ...EMPTY_FORM, ships_to: [] };
  const s = (v: string | null) => v ?? "";
  return {
    seller_type: p.seller_type ?? "",
    full_name: s(p.full_name),
    birth_date: s(p.birth_date),
    id_doc_type: p.id_doc_type ?? "",
    id_doc_number: s(p.id_doc_number),
    id_doc_country: s(p.id_doc_country),
    company_name: s(p.company_name),
    company_reg_number: s(p.company_reg_number),
    company_country: s(p.company_country),
    tax_country: s(p.tax_country),
    tin: s(p.tin),
    vat_number: s(p.vat_number),
    country: s(p.country),
    address_line1: s(p.address_line1),
    address_line2: s(p.address_line2),
    city: s(p.city),
    postal_code: s(p.postal_code),
    phone: s(p.phone),
    contact_email: s(p.contact_email),
    main_category: s(p.main_category),
    product_summary: s(p.product_summary),
    ships_to: [...p.ships_to],
    ship_from_country: s(p.ship_from_country),
    ship_from_city: s(p.ship_from_city),
    declared_truthful: !!p.declared_truthful_at,
    declared_lawful_goods: !!p.declared_lawful_goods_at,
    declared_independent: !!p.declared_independent_at,
  };
}

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------
const nstr = z.string().nullable();
const iso = z
  .string()
  .regex(/^[A-Z]{2}$/)
  .nullable();
/** save_seller_profile(p jsonb): exactly the contract's keys. */
export const saveProfilePayloadSchema = z
  .object({
    seller_type: z.enum(SELLER_TYPES).nullable(),
    full_name: nstr,
    birth_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    id_doc_type: z.enum(ID_DOC_TYPES).nullable(),
    id_doc_number: nstr,
    id_doc_country: iso,
    company_name: nstr,
    company_reg_number: nstr,
    company_country: iso,
    tax_country: iso,
    tin: nstr,
    vat_number: nstr,
    country: iso,
    address_line1: nstr,
    address_line2: nstr,
    city: nstr,
    postal_code: nstr,
    phone: nstr,
    contact_email: nstr,
    main_category: nstr,
    product_summary: nstr,
    ships_to: z.array(z.string().regex(/^[A-Z]{2}$/)),
    ship_from_country: iso,
    ship_from_city: nstr,
    declared_truthful: z.boolean(),
    declared_lawful_goods: z.boolean(),
    declared_independent: z.boolean(),
  })
  .strict();
export type SaveProfilePayload = z.output<typeof saveProfilePayloadSchema>;

/**
 * Form → payload: trimmed, "" → null, phone without spaces, and only the
 * fields of the chosen seller type (an individual sends no company or VAT,
 * a business no date of birth or ID fields).
 */
export function toSavePayload(v: VerificationForm): SaveProfilePayload {
  const t = (s: string) => (s.trim() ? s.trim() : null);
  const individual = v.seller_type === "individual";
  const business = v.seller_type === "business";
  const payload = {
    seller_type: v.seller_type || null,
    full_name: t(v.full_name),
    birth_date: business ? null : t(v.birth_date),
    id_doc_type: business ? null : v.id_doc_type || null,
    id_doc_number: business ? null : t(v.id_doc_number),
    id_doc_country: business ? null : t(v.id_doc_country),
    company_name: individual ? null : t(v.company_name),
    company_reg_number: individual ? null : t(v.company_reg_number),
    company_country: individual ? null : t(v.company_country),
    tax_country: t(v.tax_country),
    tin: t(v.tin),
    vat_number: individual ? null : t(v.vat_number.replace(/[\s.-]/g, "")),
    country: t(v.country),
    address_line1: t(v.address_line1),
    address_line2: t(v.address_line2),
    city: t(v.city),
    postal_code: t(v.postal_code),
    phone: t(normalizePhone(v.phone)),
    contact_email: t(v.contact_email),
    main_category: t(v.main_category),
    product_summary: t(v.product_summary),
    ships_to: [...new Set(v.ships_to)],
    ship_from_country: t(v.ship_from_country),
    ship_from_city: t(v.ship_from_city),
    declared_truthful: v.declared_truthful,
    declared_lawful_goods: v.declared_lawful_goods,
    declared_independent: v.declared_independent,
  };
  return parse(saveProfilePayloadSchema, payload, "The form");
}

export const REVIEW_DECISIONS = ["approved", "needs_changes", "rejected"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export const reviewPayloadSchema = z
  .object({
    p_user: z.string().uuid("Unknown seller."),
    p_decision: z.enum(REVIEW_DECISIONS),
    p_note: z.string().trim().max(2000, "The note can be at most 2000 characters.").nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.p_decision !== "approved" && (v.p_note ?? "").length < 3)
      ctx.addIssue({
        code: "custom",
        path: ["p_note"],
        message: "Write a note of at least 3 characters for the seller.",
      });
  });

// ---------------------------------------------------------------------------
// Seller
// ---------------------------------------------------------------------------
const PROFILE_TABLE = "seller_profiles";
const DOCUMENTS_TABLE = "seller_documents";
const docList = z.array(sellerDocumentSchema);

export const sellerVerificationService = {
  /** The signed-in seller's profile, or null before the first save. */
  myProfile: async (): Promise<SellerProfile | null> => {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from(PROFILE_TABLE)
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw dbError(error);
    return data ? parse(sellerProfileSchema, data, PROFILE_TABLE) : null;
  },

  myDocuments: async (): Promise<SellerDocument[]> => {
    const userId = await requireUserId();
    const { data, error } = await supabase
      .from(DOCUMENTS_TABLE)
      .select("*")
      .eq("user_id", userId)
      .order("created_at");
    if (error) throw dbError(error);
    return parse(docList, data ?? [], DOCUMENTS_TABLE);
  },

  saveDraft: async (values: VerificationForm): Promise<void> => {
    const { error } = await supabase.rpc("save_seller_profile", { p: toSavePayload(values) });
    if (error) throw dbError(error);
  },

  /** The database checks everything; its messages are meant to be shown as they are. */
  submit: async (): Promise<void> => {
    const { error } = await supabase.rpc("submit_seller_profile");
    if (error) throw dbError(error);
  },

  /**
   * Uploads to `<user_id>/<uuid>-<safe-name>`, then records the row; the
   * object is removed again if the row can't be saved.
   */
  uploadDocument: async (
    kind: DocumentKind,
    file: File,
    alreadyUploaded: number,
  ): Promise<SellerDocument> => {
    const problem = documentFileProblem(file, alreadyUploaded);
    if (problem) throw new Error(problem);
    const userId = await requireUserId();
    const path = documentPath(userId, file.name, crypto.randomUUID());
    const bucket = supabase.storage.from(DOCUMENTS_BUCKET);
    const up = await bucket.upload(path, file, { contentType: file.type, upsert: false });
    if (up.error) throw dbError(up.error as { message?: string });
    const { data, error } = await supabase
      .from(DOCUMENTS_TABLE)
      .insert({
        user_id: userId,
        kind,
        path,
        file_name: safeFileName(file.name),
        mime_type: file.type,
        size_bytes: file.size,
      })
      .select("*")
      .single();
    if (error) {
      await bucket.remove([path]).catch(() => undefined);
      throw dbError(error);
    }
    return parse(sellerDocumentSchema, data, DOCUMENTS_TABLE);
  },

  deleteDocument: async (doc: Pick<SellerDocument, "id" | "path">): Promise<void> => {
    const { data, error } = await supabase
      .from(DOCUMENTS_TABLE)
      .delete()
      .eq("id", doc.id)
      .select("id");
    if (error) throw dbError(error);
    if (!data?.length) throw new VerificationDbError("This file can't be removed now.", "42501");
    // The row is gone; the object goes too (best effort, it is private either way).
    await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .remove([doc.path])
      .catch(() => undefined);
  },

  /** A link that works for 60 seconds, created when someone clicks "Open". */
  documentUrl: async (path: string): Promise<string> => {
    const { data, error } = await supabase.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrl(path, SIGNED_URL_SECONDS);
    if (error || !data?.signedUrl) throw dbError(error as { message?: string } | null);
    return data.signedUrl;
  },

  isVerified: async (userId: string): Promise<boolean> => {
    const { data, error } = await supabase.rpc("seller_is_verified", { p_user: userId });
    if (error) throw dbError(error);
    return parse(z.boolean(), data, "seller_is_verified");
  },

  // -------------------------------------------------------------------------
  // Staff
  // -------------------------------------------------------------------------
  listApplications: async (): Promise<SellerProfile[]> => {
    const { data, error } = await supabase
      .from(PROFILE_TABLE)
      .select("*")
      .order("submitted_at", { ascending: true, nullsFirst: false });
    if (error) throw dbError(error);
    return parse(z.array(sellerProfileSchema), data ?? [], PROFILE_TABLE);
  },

  /** Documents of one seller, plus who reviewed them last (when readable). */
  applicationDetail: async (
    profile: SellerProfile,
  ): Promise<{ documents: SellerDocument[]; reviewer: string | null }> => {
    const [docs, reviewer] = await Promise.all([
      supabase.from(DOCUMENTS_TABLE).select("*").eq("user_id", profile.user_id).order("created_at"),
      profile.reviewed_by
        ? supabase
            .from("profiles")
            .select("full_name, email")
            .eq("id", profile.reviewed_by)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (docs.error) throw dbError(docs.error);
    const r = reviewer.data as { full_name?: string | null; email?: string | null } | null;
    return {
      documents: parse(docList, docs.data ?? [], DOCUMENTS_TABLE),
      reviewer: r?.full_name || r?.email || null,
    };
  },

  review: async (userId: string, decision: ReviewDecision, note: string): Promise<void> => {
    const args = parse(
      reviewPayloadSchema,
      { p_user: userId, p_decision: decision, p_note: note.trim() || null },
      "The review",
    );
    const { error } = await supabase.rpc("review_seller_profile", args);
    if (error) throw dbError(error);
  },

  /** owner id → status, for the Stores list (no sensitive columns). */
  statusesFor: async (userIds: string[]): Promise<Map<string, VerificationStatus>> => {
    const map = new Map<string, VerificationStatus>();
    if (!userIds.length) return map;
    const { data, error } = await supabase
      .from(PROFILE_TABLE)
      .select("user_id, status")
      .in("user_id", userIds);
    if (error) throw dbError(error);
    const rows = parse(
      z.array(z.object({ user_id: z.string(), status: z.enum(VERIFICATION_STATUSES) })),
      data ?? [],
      PROFILE_TABLE,
    );
    for (const r of rows) map.set(r.user_id, r.status);
    return map;
  },
};

export const SIGNED_URL_SECONDS = 60;

/**
 * Opens a document in a new tab through a signed link created on this click
 * (valid 60 seconds, never stored). The tab is opened first, synchronously,
 * so the browser doesn't block it as a pop-up.
 */
export async function openDocument(path: string, onError: (message: string) => void) {
  const tab = window.open("about:blank", "_blank");
  try {
    const url = await sellerVerificationService.documentUrl(path);
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else window.location.assign(url);
  } catch (e) {
    tab?.close();
    onError(errorText(e));
  }
}

// ---------------------------------------------------------------------------
// Staff list helpers
// ---------------------------------------------------------------------------
export type ApplicationFilter = VerificationStatus | "all";

export const applicantName = (p: SellerProfile) =>
  (p.seller_type === "business" ? p.company_name : p.full_name) || p.full_name || "No name yet";

/** Oldest submitted first; never-submitted (drafts) after them, oldest first. */
export function sortApplications(list: SellerProfile[]) {
  return [...list].sort((a, b) => {
    if (a.submitted_at && b.submitted_at) return a.submitted_at.localeCompare(b.submitted_at);
    if (a.submitted_at) return -1;
    if (b.submitted_at) return 1;
    return (a.created_at ?? "").localeCompare(b.created_at ?? "");
  });
}

/** Status filter + search over name, e-mail and company (case-insensitive). */
export function filterApplications(
  list: SellerProfile[],
  filter: ApplicationFilter,
  search: string,
) {
  const q = search.trim().toLowerCase();
  return sortApplications(list).filter(
    (p) =>
      (filter === "all" || p.status === filter) &&
      (!q ||
        [p.full_name, p.contact_email, p.company_name].some((f) => f?.toLowerCase().includes(q))),
  );
}

export const verificationKeys = {
  profile: (userId: string) => ["seller", "verification", userId] as const,
  documents: (userId: string) => ["seller", "verification-documents", userId] as const,
  staffList: ["admin", "seller-applications"] as const,
  staffDetail: (userId: string) => ["admin", "seller-applications", userId] as const,
  statuses: (ids: string[]) => ["admin", "seller-statuses", ...ids] as const,
};
