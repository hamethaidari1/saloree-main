import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createSupabaseMock } from "./supabase-mock";
import { renderWithRouter } from "./router-harness";

const mock = vi.hoisted(() => ({}) as { current?: ReturnType<typeof createSupabaseMock> });
vi.mock("@/lib/supabase", async () => {
  const { createSupabaseMock: create } = await import("./supabase-mock");
  mock.current = create();
  return { supabase: mock.current.supabase };
});

import { ISO_COUNTRY_CODES, isIsoCountry, EU_EEA_COUNTRIES } from "@/lib/iso-countries";
import {
  ageOn,
  documentFileProblem,
  documentPath,
  EMPTY_FORM,
  maskValue,
  MAX_DOCUMENT_BYTES,
  resumeStep,
  safeFileName,
  validateForm,
  type VerificationForm,
} from "@/lib/seller-verification";
import {
  errorText,
  filterApplications,
  saveProfilePayloadSchema,
  sellerProfileSchema,
  sellerVerificationService,
  toSavePayload,
  type SellerProfile,
} from "@/services/seller-verification";
import { VerificationWizard } from "@/components/seller/verification/wizard";
import {
  PayoutVerificationNotice,
  VerificationBanner,
  VerificationStatusCard,
} from "@/components/seller/verification/status";
import { SellerApplicationsPanel } from "@/components/staff/seller-applications";

const m = () => mock.current!;
const USER = "6f1c2b0a-4d3e-4f5a-9b8c-7d6e5f4a3b2c";
const NOW = new Date("2026-11-14T12:00:00Z");
beforeEach(() => {
  m().reset();
  m().state.session = { user: { id: USER } };
});

/** A complete individual (test data only, never shown anywhere). */
const INDIVIDUAL: VerificationForm = {
  ...EMPTY_FORM,
  seller_type: "individual",
  full_name: "Test Seller",
  birth_date: "1990-05-20",
  id_doc_type: "passport",
  id_doc_number: "TEST12345",
  id_doc_country: "FI",
  country: "FI",
  address_line1: "Testikatu 1",
  city: "Helsinki",
  phone: "+358 40 000 0000",
  contact_email: "seller@example.com",
  main_category: "Home Decor",
  product_summary: "Hand-made ceramic cups and bowls.",
  ships_to: ["FI", "SE"],
  ship_from_country: "FI",
  ship_from_city: "Helsinki",
  declared_truthful: true,
  declared_lawful_goods: true,
  declared_independent: true,
};
const BUSINESS: VerificationForm = {
  ...INDIVIDUAL,
  seller_type: "business",
  birth_date: "",
  id_doc_type: "",
  id_doc_number: "",
  id_doc_country: "",
  company_name: "Test Oy",
  company_reg_number: "1234567-8",
  company_country: "FI",
  vat_number: "FI12345678",
};

function profileRow(patch: Partial<Record<keyof SellerProfile, unknown>> = {}) {
  return {
    user_id: USER,
    status: "draft",
    seller_type: "individual",
    full_name: "Test Seller",
    birth_date: "1990-05-20",
    id_doc_type: "passport",
    id_doc_number: "TEST12345",
    id_doc_country: "FI",
    company_name: null,
    company_reg_number: null,
    company_country: null,
    tax_country: null,
    tin: "TIN998877",
    vat_number: null,
    country: "FI",
    address_line1: "Testikatu 1",
    address_line2: null,
    city: "Helsinki",
    postal_code: null,
    phone: "+358400000000",
    contact_email: "seller@example.com",
    main_category: null,
    product_summary: null,
    ships_to: [],
    ship_from_country: null,
    ship_from_city: null,
    declared_truthful_at: null,
    declared_lawful_goods_at: null,
    declared_independent_at: null,
    submitted_at: null,
    review_note: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: "2026-11-10T10:00:00Z",
    updated_at: "2026-11-10T10:00:00Z",
    ...patch,
  };
}
const profile = (patch: Partial<Record<keyof SellerProfile, unknown>> = {}) =>
  sellerProfileSchema.parse(profileRow(patch));

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {ui}
  </QueryClientProvider>
);

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------
describe("validation: individual vs business", () => {
  it("a complete individual and a complete business pass", () => {
    expect(validateForm(INDIVIDUAL, "complete", NOW)).toEqual({});
    expect(validateForm(BUSINESS, "complete", NOW)).toEqual({});
  });

  it("an individual needs date of birth and ID; a business needs company details instead", () => {
    const ind = validateForm({ ...EMPTY_FORM, seller_type: "individual" }, "complete", NOW);
    expect(Object.keys(ind)).toEqual(
      expect.arrayContaining(["birth_date", "id_doc_type", "id_doc_number", "id_doc_country"]),
    );
    expect(ind.company_name).toBeUndefined();
    const biz = validateForm({ ...EMPTY_FORM, seller_type: "business" }, "complete", NOW);
    expect(Object.keys(biz)).toEqual(
      expect.arrayContaining([
        "company_name",
        "company_reg_number",
        "company_country",
        "full_name",
      ]),
    );
    expect(biz.birth_date).toBeUndefined();
    expect(biz.id_doc_number).toBeUndefined();
    expect(biz.full_name).toBe("Enter the representative's full name.");
  });

  it("must be 18 or older (on the day itself counts)", () => {
    expect(ageOn("2008-11-14", NOW)).toBe(18);
    expect(ageOn("2008-11-15", NOW)).toBe(17);
    expect(
      validateForm({ ...INDIVIDUAL, birth_date: "2008-11-14" }, "complete", NOW).birth_date,
    ).toBeUndefined();
    expect(validateForm({ ...INDIVIDUAL, birth_date: "2008-11-15" }, "draft", NOW).birth_date).toBe(
      "You must be at least 18 years old to sell.",
    );
    for (const bad of ["2027-01-01", "1990-02-30", "20-05-1990"])
      expect(validateForm({ ...INDIVIDUAL, birth_date: bad }, "draft", NOW).birth_date, bad).toBe(
        "Enter a real date of birth.",
      );
  });

  it("countries are ISO 3166-1 alpha-2, uppercase", () => {
    expect(ISO_COUNTRY_CODES).toHaveLength(249);
    expect(new Set(ISO_COUNTRY_CODES).size).toBe(249);
    expect(ISO_COUNTRY_CODES.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
    expect(EU_EEA_COUNTRIES.every(isIsoCountry)).toBe(true);
    for (const bad of ["XX", "de", "DEU", "UK", ""]) expect(isIsoCountry(bad), bad).toBe(false);
    expect(validateForm({ ...INDIVIDUAL, country: "UK" }, "draft", NOW).country).toBe(
      "Choose a country from the list.",
    );
    expect(validateForm({ ...INDIVIDUAL, ships_to: ["FI", "ZZ"] }, "draft", NOW).ships_to).toBe(
      "Choose a country from the list.",
    );
    expect(validateForm({ ...INDIVIDUAL, ships_to: ["FI", "FI"] }, "draft", NOW).ships_to).toBe(
      "Each country only once.",
    );
  });

  it("phone with country code, e-mail, postal code", () => {
    expect(
      validateForm({ ...INDIVIDUAL, phone: "+93 (70) 123-4567" }, "draft", NOW).phone,
    ).toBeUndefined();
    expect(validateForm({ ...INDIVIDUAL, phone: "0401234567" }, "draft", NOW).phone).toBe(
      "Enter the number with + and the country code.",
    );
    expect(validateForm({ ...INDIVIDUAL, contact_email: "nope" }, "draft", NOW).contact_email).toBe(
      "Enter a valid e-mail address.",
    );
  });

  it("a draft may be incomplete, but what is entered must be valid", () => {
    expect(validateForm(EMPTY_FORM, "draft", NOW)).toEqual({});
    expect(
      validateForm({ ...EMPTY_FORM, id_doc_number: "<script>" }, "draft", NOW).id_doc_number,
    ).toMatch(/can contain only letters/);
  });

  it("messages never repeat the value that was typed", () => {
    const SECRET = "ZQ9SECRET";
    const errors = validateForm(
      {
        ...EMPTY_FORM,
        seller_type: "individual",
        id_doc_number: `${SECRET}<>`,
        tin: `${SECRET}<>`,
        birth_date: SECRET,
        phone: SECRET,
        contact_email: SECRET,
        vat_number: `${SECRET}<>`,
        country: SECRET,
      },
      "complete",
      NOW,
    );
    expect(Object.keys(errors).length).toBeGreaterThan(5);
    for (const msg of Object.values(errors)) expect(msg).not.toContain(SECRET);
  });

  it("resumes at the first step that isn't complete", () => {
    expect(resumeStep(EMPTY_FORM, [], NOW)).toBe("type");
    expect(resumeStep({ ...INDIVIDUAL, city: "" }, [], NOW)).toBe("address");
    expect(resumeStep(INDIVIDUAL, [], NOW)).toBe("documents");
    expect(resumeStep(INDIVIDUAL, ["id_document"], NOW)).toBe("review");
    expect(resumeStep(BUSINESS, ["id_document"], NOW)).toBe("documents"); // + company registration
  });
});

describe("save_seller_profile payload", () => {
  it("only the chosen type's fields, trimmed, phone without spaces", () => {
    const ind = toSavePayload({ ...INDIVIDUAL, company_name: "Left over", vat_number: "FI1" });
    expect(ind.company_name).toBeNull();
    expect(ind.vat_number).toBeNull();
    expect(ind.phone).toBe("+358400000000");
    expect(ind.birth_date).toBe("1990-05-20");
    const biz = toSavePayload({ ...BUSINESS, birth_date: "1990-01-01", id_doc_number: "X1234" });
    expect(biz.birth_date).toBeNull();
    expect(biz.id_doc_number).toBeNull();
    expect(biz.company_name).toBe("Test Oy");
    expect(Object.keys(ind).sort()).toEqual(Object.keys(saveProfilePayloadSchema.shape).sort());
  });

  it("accepts exactly the contract's keys", () => {
    const ok = toSavePayload(INDIVIDUAL);
    expect(saveProfilePayloadSchema.safeParse({ ...ok, status: "approved" }).success).toBe(false);
    expect(saveProfilePayloadSchema.safeParse({ ...ok, ships_to: ["fi"] }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
describe("documents: type, size, count, path", () => {
  const f = (name: string, type: string, size = 1000) => ({ name, type, size });
  it("accepts PDF, JPG and PNG up to 5 MB, at most 10 files", () => {
    expect(documentFileProblem(f("id.pdf", "application/pdf"), 0)).toBeNull();
    expect(documentFileProblem(f("id.JPEG", "image/jpeg"), 0)).toBeNull();
    expect(documentFileProblem(f("id.png", "image/png", MAX_DOCUMENT_BYTES), 9)).toBeNull();
    expect(documentFileProblem(f("id.png", "image/png", MAX_DOCUMENT_BYTES + 1), 0)).toBe(
      "Files can be at most 5 MB.",
    );
    expect(documentFileProblem(f("id.gif", "image/gif"), 0)).toBe(
      "Only PDF, JPG and PNG files can be uploaded.",
    );
    expect(documentFileProblem(f("id.pdf.exe", "application/pdf"), 0)).toBe(
      "Only PDF, JPG and PNG files can be uploaded.",
    );
    expect(documentFileProblem(f("id.png", "image/png", 0), 0)).toBe("This file is empty.");
    expect(documentFileProblem(f("id.pdf", "application/pdf"), 10)).toMatch(/at most 10 files/);
  });

  it("the path always starts with the user id; the file name is made safe", () => {
    const uuid = "11111111-2222-4333-8444-555555555555";
    expect(documentPath(USER, "Passeport Müller (1).PDF", uuid)).toBe(
      `${USER}/${uuid}-passeport-muller-1.pdf`,
    );
    for (const nasty of [
      "../../etc/passwd",
      "a/b\\c.png",
      "...",
      "",
      "<script>.jpg",
      "%2e%2e%2f.pdf",
    ]) {
      const path = documentPath(USER, nasty, uuid);
      expect(path.startsWith(`${USER}/${uuid}-`), nasty).toBe(true);
      const name = path.slice(USER.length + 1);
      expect(name, nasty).toMatch(/^[a-z0-9-]+(\.[a-z0-9]+)?$/);
      expect(name, nasty).not.toContain("..");
    }
    expect(safeFileName("x".repeat(300) + ".pdf").length).toBeLessThanOrEqual(64);
    expect(() => documentPath("", "a.pdf", uuid)).toThrow();
    expect(() => documentPath("../other-user", "a.pdf", uuid)).toThrow();
  });
});

describe("masking", () => {
  it("shows only the last 3-4 characters", () => {
    expect(maskValue("AB1234567")).toBe("•••••4567");
    expect(maskValue("12345")).toBe("•••45");
    expect(maskValue("1234")).toBe("•••4");
    expect(maskValue(null)).toBe("—");
    expect(maskValue("AB 12 34 56")).not.toContain("AB");
  });
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
describe("service: RPCs only for the profile, private documents", () => {
  it("saves through save_seller_profile and never writes seller_profiles", async () => {
    await sellerVerificationService.saveDraft(INDIVIDUAL);
    expect(m().state.rpcs[0]?.fn).toBe("save_seller_profile");
    expect((m().state.rpcs[0]?.args as { p: unknown }).p).toEqual(toSavePayload(INDIVIDUAL));
    await sellerVerificationService.submit();
    expect(m().state.rpcs[1]?.fn).toBe("submit_seller_profile");
    for (const q of m().state.queries)
      if (q.table === "seller_profiles")
        expect(q.calls.map((c) => c[0])).not.toEqual(
          expect.arrayContaining(["insert", "update", "upsert", "delete"]),
        );
  });

  it("shows the database's own message and code, never its details (which hold row values)", async () => {
    m().state.queue.push({
      error: {
        code: "P0001",
        message: "Upload your ID document before submitting.",
        details: "Failing row contains (TEST12345, 1990-05-20)",
        hint: "TEST12345",
      },
    });
    const e = await sellerVerificationService.submit().catch((x: unknown) => x);
    expect(errorText(e)).toBe("Upload your ID document before submitting. (P0001)");
    expect(JSON.stringify(e)).not.toContain("TEST12345");
    expect(String((e as Error).stack ?? "")).not.toContain("TEST12345");
  });

  it("upload: object at <user>/<uuid>-<name>, then the row; the object goes if the row fails", async () => {
    const file = new File(["%PDF-1.4"], "My ID.pdf", { type: "application/pdf" });
    m().state.queue.push({
      data: {
        id: "d1",
        user_id: USER,
        kind: "id_document",
        path: "x",
        file_name: "my-id.pdf",
        mime_type: "application/pdf",
        size_bytes: 8,
        created_at: null,
      },
    });
    await sellerVerificationService.uploadDocument("id_document", file, 0);
    const path = m().state.uploads[0]!.path;
    expect(m().state.uploads[0]!.bucket).toBe("seller-documents");
    expect(path).toMatch(new RegExp(`^${USER}/[0-9a-f-]{36}-my-id\\.pdf$`));
    const insert = m()
      .callsOn("seller_documents", 0)
      .find((c) => c[0] === "insert")!;
    expect(insert[1]).toMatchObject({ user_id: USER, kind: "id_document", path, size_bytes: 8 });

    m().state.queue.push({
      error: { code: "42501", message: "new row violates row-level security policy" },
    });
    await expect(
      sellerVerificationService.uploadDocument("id_document", file, 0),
    ).rejects.toMatchObject({
      code: "42501",
    });
    expect(m().state.removes.at(-1)).toEqual({
      bucket: "seller-documents",
      paths: [m().state.uploads[1]!.path],
    });
  });

  it("refuses a bad file before anything is sent", async () => {
    const gif = new File(["x"], "id.gif", { type: "image/gif" });
    await expect(sellerVerificationService.uploadDocument("id_document", gif, 0)).rejects.toThrow(
      "Only PDF, JPG and PNG files can be uploaded.",
    );
    expect(m().state.uploads).toHaveLength(0);
  });

  it("documents open through a 60-second signed URL only", async () => {
    const url = await sellerVerificationService.documentUrl(`${USER}/a-id.pdf`);
    expect(m().state.signed).toEqual([
      { bucket: "seller-documents", path: `${USER}/a-id.pdf`, expiresIn: 60 },
    ]);
    expect(url).toContain("/object/sign/");
  });

  it("review: a note is required to reject or request changes", async () => {
    await expect(sellerVerificationService.review(USER, "rejected", " no")).rejects.toThrow(
      /The review has unexpected values \(p_note\)/,
    );
    await sellerVerificationService.review(USER, "approved", "");
    expect(m().state.rpcs.at(-1)).toEqual({
      fn: "review_seller_profile",
      args: { p_user: USER, p_decision: "approved", p_note: null },
    });
    await sellerVerificationService.review(USER, "needs_changes", "Upload a clearer photo.");
    expect(m().state.rpcs.at(-1)?.args).toMatchObject({ p_note: "Upload a clearer photo." });
  });

  it("a missing table shows the real error", async () => {
    m().state.queue.push({
      error: {
        code: "PGRST205",
        message: "Could not find the table 'public.seller_profiles' in the schema cache",
      },
    });
    await expect(sellerVerificationService.myProfile()).rejects.toMatchObject({
      code: "PGRST205",
      message: "Could not find the table 'public.seller_profiles' in the schema cache",
    });
  });
});

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------
describe("wizard: steps and draft saving", () => {
  const renderWizard = (p: SellerProfile | null, docs: string[] = []) =>
    render(
      wrap(
        <VerificationWizard
          userId={USER}
          profile={p}
          documents={docs.map((kind, i) => ({
            id: `d${i}`,
            user_id: USER,
            kind: kind as "id_document",
            path: `${USER}/x-${i}.pdf`,
            file_name: `file-${i}.pdf`,
            mime_type: "application/pdf",
            size_bytes: 1000,
            created_at: null,
          }))}
          categories={["Home Decor"]}
          now={NOW}
        />,
      ),
    );

  it("starts at the seller type, checks it, saves the draft and moves on", async () => {
    renderWizard(null);
    expect(screen.getByRole("heading", { level: 2, name: "Seller type" })).toBeTruthy();
    expect(
      screen.getByText("You do not need a company to sell on Saloree. Individuals can sell too."),
    ).toBeTruthy();
    expect(screen.getByText("Step 1 of 7")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Choose how you sell.")).toBeTruthy();
    expect(m().state.rpcs).toHaveLength(0);
    fireEvent.click(screen.getByRole("radio", { name: /Individual/ }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Identity" })).toBeTruthy();
    expect(m().state.rpcs[0]?.fn).toBe("save_seller_profile");
    expect((m().state.rpcs[0]?.args as { p: { seller_type: string } }).p.seller_type).toBe(
      "individual",
    );
    expect(screen.getByLabelText("Date of birth")).toBeTruthy();
    expect(screen.queryByLabelText("Company name")).toBeNull();
  });

  it("Save draft on any step; a draft error is shown as the database wrote it", async () => {
    renderWizard(profile({ main_category: null }));
    // Resumes at "Your shop" (identity and address are complete).
    expect(screen.getByRole("heading", { level: 2, name: "Your shop" })).toBeTruthy();
    m().state.queue.push({
      error: { code: "P0001", message: "Your profile is being reviewed and can't be changed." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(
      await screen.findByText(
        "Your draft could not be saved: Your profile is being reviewed and can't be changed. (P0001)",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Draft saved.")).toBeTruthy();
  });

  it("business: company fields instead of date of birth and ID; Afghanistan tax hint", async () => {
    renderWizard(profile({ seller_type: "business", country: "AF", full_name: null }));
    fireEvent.click(screen.getByRole("button", { name: /Identity/ }));
    expect(await screen.findByLabelText("Company name")).toBeTruthy();
    expect(screen.getByLabelText("Name of the representative")).toBeTruthy();
    expect(screen.queryByLabelText("Date of birth")).toBeNull();
  });

  it("tax step: TIN and VAT optional; for Afghanistan they are not required", async () => {
    renderWizard(
      profile({
        country: "AF",
        main_category: "Home Decor",
        product_summary: "Hand-made ceramic cups.",
        ship_from_country: "AF",
        ship_from_city: "Kabul",
        ships_to: ["AF"],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Tax/ }));
    expect(
      await screen.findByText(
        "Selling from Afghanistan: a tax identification number (TIN) and a VAT number are not required.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByLabelText(/Tax identification number/).closest(".seller-field")?.textContent,
    ).toContain("(optional)");
  });

  it("review: all answers with Edit links, three required declarations, then submit", async () => {
    renderWizard(
      profile({
        main_category: "Home Decor",
        product_summary: "Hand-made ceramic cups.",
        ship_from_country: "FI",
        ship_from_city: "Helsinki",
        ships_to: ["FI"],
      }),
      ["id_document"],
    );
    expect(screen.getByRole("heading", { level: 2, name: "Declarations and review" })).toBeTruthy();
    const summary = screen.getByTestId("verify-summary");
    expect(summary.textContent).toContain("TEST12345");
    expect(within(summary).getAllByRole("button", { name: /^Edit/ })).toHaveLength(6);
    for (const a of ["/legal/seller-agreement", "/legal/terms", "/legal/privacy"])
      expect(document.querySelector(`a[href="${a}"]`)?.getAttribute("target")).toBe("_blank");
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByText("Please confirm the three statements.")).toBeTruthy();
    expect(m().state.rpcs).toHaveLength(0);
    for (const box of screen.getAllByRole("checkbox")) fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));
    await waitFor(() =>
      expect(m().state.rpcs.map((r) => r.fn)).toEqual([
        "save_seller_profile",
        "submit_seller_profile",
      ]),
    );
  });

  it("submitted and approved profiles are read-only", () => {
    renderWizard(profile({ status: "submitted" }));
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
  });
});

describe("status screens", () => {
  const card = (patch: Partial<Record<keyof SellerProfile, unknown>> | null) =>
    renderWithRouter(
      <VerificationStatusCard profile={patch ? profile(patch) : null} documents={[]} />,
    );

  it("draft (or nothing saved yet): complete your verification, with progress", async () => {
    card(null);
    const s = await screen.findByTestId("verify-status");
    expect(s.textContent).toContain("Complete your verification");
    expect(s.textContent).toContain("0 of 6 steps done");
  });
  it("submitted: 1-3 working days", async () => {
    card({ status: "submitted", submitted_at: "2026-11-13T09:00:00Z" });
    expect((await screen.findByTestId("verify-status")).textContent).toContain(
      "This usually takes 1-3 working days.",
    );
  });
  it("needs_changes and rejected: the staff note, prominently", async () => {
    card({ status: "needs_changes", review_note: "Upload a clearer photo of the ID." });
    const s = await screen.findByTestId("verify-status");
    expect(s.textContent).toContain("Please update your details");
    expect(s.querySelector("blockquote")?.textContent).toContain(
      "Upload a clearer photo of the ID.",
    );
  });
  it("rejected", async () => {
    card({ status: "rejected", review_note: "We can't verify this document." });
    expect((await screen.findByTestId("verify-status")).textContent).toContain(
      "Your verification was not approved",
    );
  });
  it("approved: success; the banner and the payout notice disappear", async () => {
    card({ status: "approved" });
    expect((await screen.findByTestId("verify-status")).textContent).toContain("You're verified");
  });

  it("banner and payout notice until approved", async () => {
    m().state.queue.push(
      { data: profileRow({ status: "submitted" }) },
      { data: profileRow({ status: "submitted" }) },
    );
    renderWithRouter(
      <>
        <VerificationBanner userId={USER} />
        <PayoutVerificationNotice userId={USER} />
      </>,
    );
    expect((await screen.findByTestId("verify-banner")).textContent).toContain(
      "We are reviewing your details.",
    );
    expect(screen.getByTestId("payout-verification-notice").textContent).toContain(
      "Payouts start after your seller details are verified.",
    );
  });

  it("approved: no banner, no payout notice", async () => {
    m().state.fallback = { data: profileRow({ status: "approved" }) };
    const { container } = renderWithRouter(
      <>
        <VerificationBanner userId={USER} />
        <PayoutVerificationNotice userId={USER} />
      </>,
    );
    await waitFor(() => expect(m().state.queries.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.querySelector('[data-testid="verify-banner"]')).toBeNull();
    expect(container.querySelector('[data-testid="payout-verification-notice"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------
describe("staff: seller applications", () => {
  const list = [
    profile({
      user_id: "00000000-0000-4000-8000-00000000000a",
      status: "submitted",
      full_name: "Late Applicant",
      submitted_at: "2026-11-12T10:00:00Z",
    }),
    profile({
      user_id: "00000000-0000-4000-8000-00000000000b",
      status: "submitted",
      full_name: "Early Applicant",
      submitted_at: "2026-11-01T10:00:00Z",
      contact_email: "early@example.com",
    }),
    profile({
      user_id: "00000000-0000-4000-8000-00000000000c",
      status: "approved",
      full_name: "Done Seller",
      submitted_at: "2026-10-01T10:00:00Z",
    }),
    profile({
      user_id: "00000000-0000-4000-8000-00000000000d",
      status: "draft",
      seller_type: "business",
      company_name: "Draft Oy",
      full_name: "Rep",
      submitted_at: null,
    }),
  ];

  it("filters by status, oldest submitted first, searches name, e-mail and company", () => {
    const ids = (f: Parameters<typeof filterApplications>[1], q: string) =>
      filterApplications(list, f, q).map((p) => p.user_id.slice(-1));
    expect(ids("submitted", "")).toEqual(["b", "a"]);
    expect(ids("all", "")).toEqual(["c", "b", "a", "d"]);
    expect(ids("all", "EARLY@")).toEqual(["b"]);
    expect(ids("all", "draft oy")).toEqual(["d"]);
  });

  function renderPanel(canReview: boolean) {
    m().state.queue.push({ data: list.map((p) => ({ ...profileRow(), ...p })) });
    return renderWithRouter(<SellerApplicationsPanel canReview={canReview} />);
  }

  it("list: submitted by default, with counts and masked numbers", async () => {
    renderPanel(true);
    const table = await screen.findByTestId("applications-table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByRole("rowheader").textContent)).toEqual([
      "Early Applicantearly@example.com",
      "Late Applicantseller@example.com",
    ]);
    expect(table.textContent).not.toContain("TEST12345");
    expect(table.textContent).toContain("•••••2345");
    expect(table.textContent).not.toContain("TIN998877");
    expect(screen.getByRole("radio", { name: /Submitted/ }).textContent).toContain("2");
    fireEvent.click(screen.getByRole("radio", { name: /^All/ }));
    expect(within(screen.getByTestId("applications-table")).getAllByRole("row")).toHaveLength(5);
  });

  it("detail: full values and documents for staff; reviewers get the three actions", async () => {
    renderPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: "Early Applicant" }));
    const drawer = await screen.findByRole("dialog");
    expect(drawer.textContent).toContain("TEST12345");
    expect(drawer.textContent).toContain("TIN998877");
    for (const name of ["Approve", "Request changes", "Reject"])
      expect(within(drawer).getByRole("button", { name })).toBeTruthy();
  });

  it("reject needs a note; the database's refusal is shown as it is", async () => {
    renderPanel(true);
    fireEvent.click(await screen.findByRole("button", { name: "Early Applicant" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: "Reject" }),
    );
    const dialog = await screen.findByRole("dialog", { name: /Reject Early Applicant/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(
      await within(dialog).findByText("Write a note of at least 3 characters for the seller."),
    ).toBeTruthy();
    m().state.queue.push({
      error: { code: "42501", message: "You cannot review your own seller profile." },
    });
    fireEvent.change(within(dialog).getByLabelText(/Note to the seller/), {
      target: { value: "The ID photo is not readable." },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }));
    expect(
      await within(dialog).findByText("You cannot review your own seller profile. (42501)"),
    ).toBeTruthy();
    expect(m().state.rpcs.at(-1)).toMatchObject({
      fn: "review_seller_profile",
      args: { p_decision: "rejected", p_note: "The ID photo is not readable." },
    });
  });

  it("finance (read-only): the same list and detail, no action buttons", async () => {
    renderPanel(false);
    fireEvent.click(await screen.findByRole("button", { name: "Early Applicant" }));
    const drawer = await screen.findByRole("dialog");
    expect(drawer.textContent).toContain("TEST12345");
    for (const name of ["Approve", "Request changes", "Reject"])
      expect(within(drawer).queryByRole("button", { name })).toBeNull();
  });

  it("the panels give review rights only to admin and content_admin", () => {
    const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
    const panel = (p: string) =>
      read(p)
        .match(/<SellerApplicationsPanel\b[^>]*\/>/)?.[0]
        .replace(/\s+/g, " ") ?? "";
    expect(panel("src/routes/admin.tsx")).toMatch(/\bcanReview\b(?!=)/);
    expect(panel("src/routes/admin_.marketplace.tsx")).toMatch(/\bcanReview\b(?!=)/);
    expect(panel("src/routes/admin_.finance.tsx")).toContain('canReview={roles.includes("admin")}');
  });
});

// ---------------------------------------------------------------------------
// Privacy by construction
// ---------------------------------------------------------------------------
describe("privacy: no sensitive value can leak", () => {
  const files = [
    "src/lib/seller-verification.ts",
    "src/services/seller-verification.ts",
    "src/components/staff/seller-applications.tsx",
    ...readdirSync(join(process.cwd(), "src/components/seller/verification")).map(
      (f) => `src/components/seller/verification/${f}`,
    ),
  ];
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("no logging, no browser storage, no public URLs, no query strings", () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/console\.(log|info|warn|error|debug)/);
      expect(src, f).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
      expect(src, f).not.toMatch(/getPublicUrl/);
      expect(src, f).not.toMatch(/[?&](id_doc_number|tin|vat_number|birth_date)=/);
      expect(src, f).not.toMatch(/search:\s*\{[^}]*(id_doc|tin|birth|vat)/);
    }
  });

  it("thrown errors and toasts never interpolate a form or profile value", () => {
    const sensitive =
      /\$\{[^}]*(id_doc_number|tin|vat_number|birth_date|company_reg_number|phone|address_line|full_name|values\.|profile\.|p\.)[^}]*\}/;
    for (const f of files) {
      const src = read(f);
      for (const m of src.matchAll(/(throw new \w+\(|toast\.\w+\()([^;]*)/g))
        expect(m[2] ?? "", `${f}: ${m[0]}`).not.toMatch(sensitive);
    }
  });

  it("errors never read details or hint", () => {
    expect(read("src/services/seller-verification.ts")).not.toMatch(/\.details|\.hint/);
  });
});

// ---------------------------------------------------------------------------
// Where staff publish stores, and the new-seller flow
// ---------------------------------------------------------------------------
describe("stores: owner verification and the database's refusal", () => {
  it("shows the owner's status and the refusal text as the database wrote it", async () => {
    const { StoresPanel } = await import("@/components/admin/stores-panel");
    const store = {
      id: "s1",
      name: "Beta Decor",
      slug: "beta",
      status: "draft",
      owner_id: USER,
      created_at: "2026-11-10T10:00:00Z",
      products: [{ count: 0 }],
    };
    m().state.queue.push(
      { data: [store] },
      { data: [{ id: USER, email: "owner@example.com", full_name: "Owner" }] },
      { data: [{ user_id: USER, status: "submitted" }] },
    );
    renderWithRouter(<StoresPanel />);
    expect((await screen.findByTestId("owner-verification")).textContent).toBe("Seller submitted");
    m().state.queue.push(
      {
        error: {
          code: "P0001",
          message: "The seller must be verified before the store can be published",
        },
      },
      // The panel reloads its lists afterwards.
      { data: [store] },
      { data: [{ id: USER, email: "owner@example.com", full_name: "Owner" }] },
      { data: [{ user_id: USER, status: "submitted" }] },
    );
    fireEvent.click(screen.getByRole("button", { name: "Approve (publish)" }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: "Approve (publish)" }));
    expect((await screen.findByTestId("publish-error")).textContent).toBe(
      "The seller must be verified before the store can be published (P0001)",
    );
  });
});

describe("a new seller without a store", () => {
  it("verification first; the store form comes after submitting", async () => {
    const { GettingStarted } = await import("@/components/seller/verification/onboarding");
    m().state.fallback = { data: null };
    renderWithRouter(
      <GettingStarted userId={USER} categoryNames={[]}>
        <p>Create store form</p>
      </GettingStarted>,
    );
    expect(await screen.findByRole("heading", { level: 2, name: "Seller type" })).toBeTruthy();
    expect(screen.queryByText("Create store form")).toBeNull();
  });

  it("if verification can't be loaded, the real error shows and the store can still be created", async () => {
    const { GettingStarted } = await import("@/components/seller/verification/onboarding");
    m().state.fallback = {
      error: {
        code: "PGRST205",
        message: "Could not find the table 'public.seller_profiles' in the schema cache",
      },
    };
    renderWithRouter(
      <GettingStarted userId={USER} categoryNames={[]}>
        <p>Create store form</p>
      </GettingStarted>,
    );
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Could not find the table 'public.seller_profiles' in the schema cache (PGRST205)",
    );
    expect(screen.getByText("Create store form")).toBeTruthy();
  });
});
