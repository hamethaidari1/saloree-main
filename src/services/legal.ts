/**
 * Legal pages: the bundled texts (src/content/legal) and the real values for
 * their placeholders (company details and the platform commission).
 */
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { LEGAL_SOURCES } from "@/content/legal";
import {
  checkLegalSource,
  LEGAL_SLUGS,
  legalFrontmatterSchema,
  splitFrontmatter,
  type LegalSlug,
  type LegalValues,
} from "@/lib/legal-core";
import { parseLegalMarkdown, type Block } from "@/lib/legal-markdown";
import { supabase } from "@/lib/supabase";

export interface LegalDocument {
  slug: LegalSlug;
  title: string;
  /** YYYY-MM-DD; also the version a seller accepts. */
  updated: string;
  blocks: Block[];
}

/** Parses the given sources ({ "./terms.md": "…" }); invalid files are skipped with a warning. */
export function loadLegalDocuments(sources: Record<string, string>): LegalDocument[] {
  const docs: LegalDocument[] = [];
  for (const [path, source] of Object.entries(sources)) {
    const fileSlug = path.replace(/^.*\//, "").replace(/\.md$/, "");
    const problems = checkLegalSource(fileSlug, source);
    if (problems.length) {
      console.warn(`Legal page ${fileSlug}.md is not shown: ${problems.join("; ")}`);
      continue;
    }
    const parts = splitFrontmatter(source)!;
    const fm = legalFrontmatterSchema.parse(parts.data);
    docs.push({
      slug: fm.slug,
      title: fm.title,
      updated: fm.updated,
      blocks: parseLegalMarkdown(parts.body, fm.title),
    });
  }
  return docs.sort((a, b) => LEGAL_SLUGS.indexOf(a.slug) - LEGAL_SLUGS.indexOf(b.slug));
}

let cache: LegalDocument[] | null = null;
/** The documents in this build, in footer order. */
export const legalDocuments = () => (cache ??= loadLegalDocuments(LEGAL_SOURCES));
export const legalDocument = (slug: string) => legalDocuments().find((d) => d.slug === slug);

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------
const text = z.preprocess(
  (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined),
  z.string().optional(),
);
const footerSettingsSchema = z
  .object({
    legal_name: text,
    business_id: text,
    address: text,
    support_email: z.preprocess(
      (v) => (typeof v === "string" && v.trim() ? v.trim() : undefined),
      z.string().email().optional().catch(undefined),
    ),
    stripe_fees_text: text,
  })
  .passthrough();

/** public_commission_percent(): a numeric (number or numeric string) or null. */
export const publicCommissionSchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
  z.number().finite().min(0).max(100).nullable(),
);

/**
 * The card processor the checkout uses (src/services/card-payment.ts). The
 * Seller Agreement reads "Card payment processor fees ([[Stripe]]) are …", so
 * this is the processor's name, not the admin's "who pays" wording.
 */
export const CARD_PROCESSOR_NAME = "Stripe";

/** "12.5" → "12.5"; "10.00" → "10". The text adds "%". */
export const formatCommission = (n: number) =>
  n.toLocaleString("en", { maximumFractionDigits: 2, useGrouping: false });

export interface LegalSettings {
  values: LegalValues;
  /** Why a value could not be read (shown to staff only). */
  problems: string[];
}

const describeError = (where: string, e: { message?: string; code?: string }) =>
  `${where}: ${e.message ?? "unknown error"}${e.code ? ` (${e.code})` : ""}`;

export function toLegalSettings(
  footerSettings: unknown,
  commission: unknown,
  problems: string[] = [],
): LegalSettings {
  const fs = footerSettingsSchema.safeParse(footerSettings ?? {});
  const company = fs.success ? fs.data : {};
  const values: LegalValues = { Stripe: CARD_PROCESSOR_NAME };
  if (company.legal_name) values.COMPANY_NAME = company.legal_name;
  if (company.business_id) values.BUSINESS_ID = company.business_id;
  if (company.address) values.COMPANY_ADDRESS = company.address;
  if (company.support_email) values.SUPPORT_EMAIL = company.support_email;
  if (company.stripe_fees_text) values.WHO_PAYS_STRIPE_FEES = company.stripe_fees_text;
  const rate = publicCommissionSchema.safeParse(commission);
  if (rate.success && rate.data !== null) values.COMMISSION_RATE = formatCommission(rate.data);
  else if (!rate.success)
    problems.push("public_commission_percent returned something that is not a percentage.");
  return { values, problems };
}

export const legalService = {
  /** Never throws: a value that can't be read is simply missing (with the reason). */
  settings: async (): Promise<LegalSettings> => {
    const [site, rate] = await Promise.all([
      supabase.from("site_settings").select("footer_settings").limit(1).maybeSingle(),
      // The rate only, through a function visitors may call; the table itself stays private.
      supabase.rpc("public_commission_percent"),
    ]);
    const problems: string[] = [];
    if (site.error) problems.push(describeError("site_settings", site.error));
    if (rate.error) problems.push(describeError("public_commission_percent", rate.error));
    else if (rate.data == null)
      problems.push("public_commission_percent returned no rate, so the commission is hidden.");
    return toLegalSettings(
      (site.data as { footer_settings?: unknown } | null)?.footer_settings,
      rate.error ? null : rate.data,
      problems,
    );
  },
};

export const legalSettingsQuery = queryOptions({
  queryKey: ["legal", "settings"],
  queryFn: legalService.settings,
  staleTime: 5 * 60_000,
});
