import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { storeUrl } from "@/lib/host";
import type { StoreTemplateRow } from "@/data/db";
import { sellerService } from "@/services/seller";
import { storeThemeQuery, themesService } from "@/services/themes";
import { templateDataFromSeller, type TemplateData } from "@/templates/data";
import {
  isTemplateCode,
  resolveTheme,
  TEMPLATES,
  type TemplateDefinition,
} from "@/templates/registry";
import { TemplateView } from "@/templates/render";
import type { ThemeSettings } from "@/templates/settings";
import { useSeller } from "./seller-context";

/**
 * Everything the Themes page and the Customize editor need, from real data:
 * the seller's own products (so a draft store can be previewed), the
 * template catalogue, this store's grants and its saved theme.
 */
export function useSellerThemeData() {
  const { store, categories } = useSeller();
  const products = useQuery({
    queryKey: ["seller", "products", store.id],
    queryFn: () => sellerService.getStoreProducts(store.id),
  });
  const templates = useQuery({
    queryKey: ["store-templates", "active"],
    queryFn: themesService.listActive,
    retry: false,
  });
  const grants = useQuery({
    queryKey: ["store-template-grants", store.id],
    queryFn: () => themesService.getGrants(store.id),
    retry: false,
  });
  const theme = useQuery({ ...storeThemeQuery(store.id), retry: false });

  const data: TemplateData | null = useMemo(
    () => (products.data ? templateDataFromSeller(store, products.data, categories) : null),
    [products.data, store, categories],
  );
  // Only templates this version of the app can render.
  const known = useMemo(
    () => (templates.data ?? []).filter((t) => isTemplateCode(t.code)),
    [templates.data],
  );
  const current = theme.isSuccess ? resolveTheme(theme.data) : null;
  const currentRow = current ? (known.find((t) => t.code === current.template.code) ?? null) : null;

  const queries = [products, templates, grants, theme] as const;
  return {
    store,
    data,
    templates: known,
    grants: new Set(grants.data ?? []),
    theme: theme.data ?? null,
    current,
    currentRow,
    isPending: queries.some((q) => q.isPending),
    error: queries.find((q) => q.error)?.error ?? null,
    refetch: () => Promise.all(queries.map((q) => q.refetch())),
  };
}

export const templateFor = (row: StoreTemplateRow): TemplateDefinition =>
  isTemplateCode(row.code) ? TEMPLATES[row.code] : TEMPLATES.classic;

export const LOCKED_TEXT =
  "Purchase will be available when online payments launch. Contact Saloree to unlock it.";

/** Owner preview: the live store when published, the private owner preview otherwise. */
export function PreviewStoreButton({ slug, published }: { slug: string; published: boolean }) {
  return published ? (
    <Button asChild variant="outline">
      <a href={storeUrl(slug)} target="_blank" rel="noopener noreferrer">
        Preview store <ExternalLink />
      </a>
    </Button>
  ) : (
    <Button asChild variant="outline">
      <Link to="/preview/store" target="_blank">
        Preview store <ExternalLink />
      </Link>
    </Button>
  );
}

/** Can this store use the template right now? */
export const isUnlocked = (row: StoreTemplateRow, grants: Set<string>) =>
  !row.is_premium || grants.has(row.id);

/** "$12.50" from cents; null when there is no price. */
export function formatPrice(cents: number | null, currency: string | null) {
  if (cents == null) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: (currency || "USD").toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency ?? ""}`.trim();
  }
}

/**
 * A real render of the template, scaled down. Inert (no focus, no clicks)
 * and hidden from assistive tech — the card around it carries the label.
 */
export function TemplateMiniature({
  template,
  settings,
  data,
  width = 1280,
  scale = 0.25,
  maxProducts = 8,
}: {
  template: TemplateDefinition;
  settings: ThemeSettings;
  data: TemplateData;
  width?: number;
  scale?: number;
  maxProducts?: number;
}) {
  const small = useMemo(
    () => ({ ...data, products: data.products.slice(0, maxProducts) }),
    [data, maxProducts],
  );
  return (
    <div className="tpl-mini" aria-hidden inert style={{ ["--mini-scale" as string]: scale }}>
      <div className="tpl-mini-stage" style={{ inlineSize: width }}>
        <TemplateView template={template} settings={settings} data={small} mode="preview" />
      </div>
    </div>
  );
}
