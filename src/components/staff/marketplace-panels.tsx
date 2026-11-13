import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PanelState } from "@/components/seller/panel-state";
import { adminKeys } from "@/components/admin/keys";
import { matches, useAdminAction } from "@/components/admin/use-admin-action";
import { adminService } from "@/services/admin";
import { friendlyError } from "@/services/errors";
import {
  groupSellers,
  marketplaceService,
  siteTextsSchema,
  type SiteTexts,
} from "@/services/marketplace";

const fmt = new Intl.NumberFormat("en-US");

export function Tile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="admin-tile">
      <span className="admin-tile-label">{label}</span>
      <strong className="admin-tile-value">{value}</strong>
      {detail && <span className="admin-tile-detail">{detail}</span>}
    </div>
  );
}

export function LoadError({
  what,
  error,
  retry,
}: {
  what: string;
  error: unknown;
  retry: () => void;
}) {
  return (
    <div role="alert" className="seller-empty">
      <h3>{what} could not be loaded.</h3>
      <p>{friendlyError(error)}</p>
      <Button variant="outline" size="sm" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}

export function MarketplaceOverview() {
  const q = useQuery({
    queryKey: [...adminKeys.all, "marketplace-overview"],
    queryFn: marketplaceService.getOverview,
  });
  if (q.isPending)
    return (
      <div className="admin-tiles" aria-busy="true" aria-label="Loading overview">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="admin-tile skeleton" />
        ))}
      </div>
    );
  if (q.isError) return <LoadError what="The overview" error={q.error} retry={() => q.refetch()} />;
  const d = q.data;
  return (
    <section aria-label="Marketplace overview" className="admin-tiles">
      <Tile
        label="Waiting for approval"
        value={fmt.format(d.storesWaiting)}
        detail="Stores in draft"
      />
      <Tile label="Published stores" value={fmt.format(d.storesPublished)} />
      <Tile
        label="Products"
        value={fmt.format(d.productsActive + d.productsDraft)}
        detail={`${fmt.format(d.productsActive)} active · ${fmt.format(d.productsDraft)} draft`}
      />
      <Tile label="Sellers" value={fmt.format(d.sellers)} detail="People who own a store" />
      <Tile label="Categories" value={fmt.format(d.categories)} />
    </section>
  );
}

/** Store owners with their stores and a "Copy email" button. */
export function SellersPanel() {
  // Same cached store list as the Stores tab, grouped by owner.
  const sellers = useQuery({
    queryKey: adminKeys.stores,
    queryFn: adminService.listStores,
    select: groupSellers,
  });
  const [search, setSearch] = useState("");
  return (
    <section aria-labelledby="sellers-heading">
      <div className="seller-panel-head">
        <div>
          <h2 id="sellers-heading">Sellers</h2>
          <p>Everyone who owns a store, to contact them about their store.</p>
        </div>
        <Input
          type="search"
          className="admin-search"
          placeholder="Search name, email or store"
          aria-label="Search sellers"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <PanelState
        query={sellers}
        errorText="Sellers could not be loaded."
        empty={{
          title: "No sellers yet",
          description: "Sellers appear when someone creates a store.",
        }}
      >
        {(all) => {
          const list = all.filter((s) =>
            matches(search, s.name, s.email, ...s.stores.map((x) => x.name)),
          );
          if (!list.length) return <p className="seller-hint">No sellers match “{search}”.</p>;
          return (
            <ul className="seller-list">
              {list.map((s) => (
                <li key={s.ownerId} className="seller-row">
                  <div className="min-w-0 flex-1">
                    <h3 className="seller-row-title">{s.name ?? "No name"}</h3>
                    <p className="seller-row-meta">
                      <bdi>{s.email ?? "No email"}</bdi>
                      <span aria-hidden>·</span>
                      {s.productCount} product{s.productCount === 1 ? "" : "s"}
                    </p>
                    <ul className="staff-chips" aria-label="Stores">
                      {s.stores.map((st) => (
                        <li key={st.id}>
                          {st.name}{" "}
                          <Badge variant={st.status === "published" ? "default" : "secondary"}>
                            {st.status}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {s.email && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(s.email!);
                          toast.success("Email copied");
                        } catch {
                          toast.error(`Couldn't copy. The email is ${s.email}`);
                        }
                      }}
                    >
                      <Copy />
                      Copy email
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          );
        }}
      </PanelState>
    </section>
  );
}

const SITE_TEXT_GROUPS: {
  title: string;
  fields: { key: keyof SiteTexts; label: string; long?: boolean; hint?: string }[];
}[] = [
  {
    title: "Home page hero (not shown on the live home page yet)",
    fields: [
      { key: "hero_title", label: "Hero title" },
      { key: "hero_subtitle", label: "Hero subtitle", long: true },
      { key: "hero_button_text", label: "Main button text" },
      {
        key: "hero_button_link",
        label: "Main button link",
        hint: "A path like /products or an https:// address.",
      },
      { key: "secondary_button_text", label: "Second button text" },
      { key: "secondary_button_link", label: "Second button link" },
    ],
  },
  {
    title: "Footer",
    fields: [
      { key: "footer_description", label: "Short description under the logo", long: true },
      {
        key: "copyright_text",
        label: "Copyright line",
        hint: "Leave empty to show “© <year> Saloree”.",
      },
    ],
  },
  {
    title: "Social links (https only; empty = hidden)",
    fields: [
      { key: "facebook_url", label: "Facebook" },
      { key: "instagram_url", label: "Instagram" },
      { key: "twitter_url", label: "X (Twitter)" },
    ],
  },
];

/** site_settings content fields. footer_settings (company details) is never read or sent. */
export function SiteTextsPanel() {
  const q = useQuery({
    queryKey: [...adminKeys.all, "site-texts"],
    queryFn: marketplaceService.getSiteTexts,
    retry: false,
  });
  if (q.isPending)
    return (
      <div className="seller-skeleton" aria-busy="true" aria-label="Loading">
        <div />
      </div>
    );
  if (q.isError)
    return <LoadError what="The site texts" error={q.error} retry={() => q.refetch()} />;
  return <SiteTextsForm key={q.dataUpdatedAt} row={q.data} />;
}

function SiteTextsForm({ row }: { row: { id: string } & SiteTexts }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      SITE_TEXT_GROUPS.flatMap((g) => g.fields).map((f) => [f.key, row[f.key] ?? ""]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useAdminAction(
    (v: Record<string, string>) => marketplaceService.saveSiteTexts(row.id, v),
    {
      success: () => "Site texts saved",
    },
  );
  return (
    <form
      className="seller-form staff-form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = siteTextsSchema.safeParse(values);
        if (!parsed.success) {
          const fe = parsed.error.flatten().fieldErrors as Record<string, string[] | undefined>;
          return setErrors(
            Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? ""])),
          );
        }
        setErrors({});
        await save.mutateAsync(values).catch(() => {});
      }}
    >
      {SITE_TEXT_GROUPS.map((g) => (
        <fieldset key={g.title} className="staff-fieldset">
          <legend>{g.title}</legend>
          {g.fields.map((f) => {
            const id = `site-${f.key}`;
            const common = {
              id,
              value: values[f.key] ?? "",
              "aria-invalid": !!errors[f.key],
              onChange: (e: { target: { value: string } }) =>
                setValues((v) => ({ ...v, [f.key]: e.target.value })),
            };
            return (
              <div key={f.key} className="seller-field">
                <Label htmlFor={id}>{f.label}</Label>
                {f.long ? <Textarea rows={2} {...common} /> : <Input {...common} />}
                {errors[f.key] ? (
                  <p className="seller-error">{errors[f.key]}</p>
                ) : (
                  f.hint && <p className="seller-hint">{f.hint}</p>
                )}
              </div>
            );
          })}
        </fieldset>
      ))}
      <p className="seller-hint">
        Company details (legal name, business ID, address) are managed by finance.
      </p>
      <div>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save site texts"}
        </Button>
      </div>
    </form>
  );
}
