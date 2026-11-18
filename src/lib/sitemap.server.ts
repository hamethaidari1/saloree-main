/**
 * GET /sitemap.xml — the data (public reads with the publishable key, the
 * same rows any visitor can see) and the response. Cached for one hour.
 */
import { supabase } from "./supabase";
import { hostConfig } from "./host";
import { legalDocuments } from "@/services/legal";
import { siteOrigin } from "./seo";
import { sitemapEntries, sitemapXml, type SitemapData } from "./sitemap";

const PAGE = 1000; // PostgREST returns at most 1,000 rows per request.
const MAX_ROWS = 200_000;

async function all<T>(
  query: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

type ProductRow = {
  id: string;
  slug: string | null;
  status: string;
  created_at: string;
  price: number | string;
  categories: { slug: string } | null;
  stores: { status: string } | null;
};

export async function loadSitemapData(): Promise<SitemapData> {
  const [products, stores, categories] = await Promise.all([
    all<ProductRow>((from, to) =>
      supabase
        .from("products")
        .select("id, slug, status, created_at, price, categories(slug), stores!inner(status)")
        .eq("status", "active")
        .eq("stores.status", "published")
        .order("created_at", { ascending: false })
        .range(from, to),
    ),
    all<SitemapData["stores"][number]>((from, to) =>
      supabase
        .from("stores")
        .select("slug, status, updated_at")
        .eq("status", "published")
        .order("created_at")
        .range(from, to),
    ),
    all<{ slug: string }>((from, to) =>
      supabase.from("categories").select("slug").order("name").range(from, to),
    ),
  ]);
  return {
    products: products.map((p) => ({
      id: p.id,
      slug: p.slug,
      status: p.status,
      created_at: p.created_at,
      price: p.price,
      category: p.categories?.slug ?? null,
      store_status: p.stores?.status ?? null,
    })),
    stores,
    categories,
    legal: legalDocuments().map((d) => ({ slug: d.slug, updated: d.updated })),
  };
}

export async function handleSitemap(
  request: Request,
  load: () => Promise<SitemapData> = loadSitemapData,
): Promise<Response> {
  const origin = siteOrigin(hostConfig().rootDomain);
  if (!origin) return new Response("No site domain is configured.", { status: 404 });
  const raw = new URL(request.url).searchParams.get("part");
  const part = raw === null ? null : Number(raw);
  try {
    const xml = sitemapXml(sitemapEntries(await load()), origin, part);
    if (xml === null) return new Response("Not found", { status: 404 });
    return new Response(xml, {
      status: 200,
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=3600, s-maxage=3600",
      },
    });
  } catch (e) {
    // Never cached: the next request tries again. Only the error's type is logged.
    console.warn(`sitemap.xml could not be built (${e instanceof Error ? e.name : "error"}).`);
    return new Response("The sitemap is temporarily unavailable.", {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "300" },
    });
  }
}
