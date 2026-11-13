import { queryOptions } from "@tanstack/react-query";
import type { FooterLinkRow, SiteSettingsFooterRow } from "@/data/db";
import { supabase } from "@/lib/supabase";
import { safeHttpsUrl } from "@/lib/tracking";

export interface FooterLink {
  label: string;
  /** An internal path ("/stores") or an https:// URL. */
  url: string;
}
export interface FooterColumn {
  heading: string;
  links: FooterLink[];
}
export interface FooterCompany {
  legalName: string | null;
  businessId: string | null;
  address: string | null;
  /** Shown as a mailto link; only a plausible email address is accepted. */
  supportEmail: string | null;
}
export interface FooterContent {
  description: string | null;
  /** copyright_text, or null to use "© <year> Saloree". */
  copyright: string | null;
  social: { label: "Facebook" | "Instagram" | "X (Twitter)"; url: string }[];
  company: FooterCompany;
  /** Columns from footer_links; empty means "use the built-in columns". */
  columns: FooterColumn[];
}

export const EMPTY_FOOTER: FooterContent = {
  description: null,
  copyright: null,
  social: [],
  company: { legalName: null, businessId: null, address: null, supportEmail: null },
  columns: [],
};

const EMAIL_RE = /^[^\s@<>()"']+@[^\s@<>()"']+\.[^\s@<>()"']{2,}$/;
const emailOrNull = (v: unknown) =>
  typeof v === "string" && EMAIL_RE.test(v.trim()) && v.trim().length <= 254 ? v.trim() : null;

const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** An internal absolute path ("/x", not "//x") or a well-formed https URL; else null. */
export function safeFooterUrl(url: string | null | undefined): string | null {
  const u = url?.trim();
  if (!u) return null;
  if (u.startsWith("/") && !u.startsWith("//") && !/\s/.test(u)) return u;
  return safeHttpsUrl(u);
}

export function toFooterContent(
  settings: SiteSettingsFooterRow | null,
  links: FooterLinkRow[],
): FooterContent {
  const fs = settings?.footer_settings ?? {};
  const social = (
    [
      ["Facebook", settings?.facebook_url],
      ["Instagram", settings?.instagram_url],
      ["X (Twitter)", settings?.twitter_url],
    ] as const
  ).flatMap(([label, url]) => {
    const safe = safeHttpsUrl(url);
    return safe ? [{ label, url: safe }] : [];
  });

  // Group active rows by category, columns in order of their first link.
  const columns: FooterColumn[] = [];
  const sorted = links
    .filter((l) => l.is_active !== false)
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));
  for (const row of sorted) {
    const heading = text(row.category);
    const label = text(row.label);
    const url = safeFooterUrl(row.url);
    if (!heading || !label || !url) continue;
    let col = columns.find((c) => c.heading === heading);
    if (!col) columns.push((col = { heading, links: [] }));
    col.links.push({ label, url });
  }

  return {
    description: text(settings?.footer_description),
    copyright: text(settings?.copyright_text),
    social,
    company: {
      legalName: text(fs["legal_name"]),
      businessId: text(fs["business_id"]),
      address: text(fs["address"]),
      supportEmail: emailOrNull(fs["support_email"]),
    },
    columns,
  };
}

export const siteService = {
  getFooter: async (): Promise<FooterContent> => {
    const [settingsRes, linksRes] = await Promise.all([
      supabase
        .from("site_settings")
        .select(
          "footer_description, copyright_text, facebook_url, instagram_url, twitter_url, footer_settings",
        )
        .limit(1)
        .maybeSingle(),
      supabase
        .from("footer_links")
        .select("id, category, label, url, display_order, is_active")
        .eq("is_active", true)
        .order("display_order"),
    ]);
    if (settingsRes.error) throw settingsRes.error;
    if (linksRes.error) throw linksRes.error;
    return toFooterContent(
      settingsRes.data as SiteSettingsFooterRow | null,
      (linksRes.data ?? []) as FooterLinkRow[],
    );
  },
};

export const footerQuery = queryOptions({
  queryKey: ["site", "footer"],
  queryFn: siteService.getFooter,
  staleTime: 5 * 60_000,
});
