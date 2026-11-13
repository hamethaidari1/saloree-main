import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, Paintbrush } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, type ConfirmRequest } from "@/components/marketplace/confirm-dialog";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import { SellerPageHeader } from "@/components/seller/seller-shell";
import {
  formatPrice,
  isUnlocked,
  LOCKED_TEXT,
  PreviewStoreButton,
  templateFor,
  TemplateMiniature,
  useSellerThemeData,
} from "@/components/seller/theme-data";
import type { StoreTemplateRow } from "@/data/db";
import { saveAppearance, themeError } from "@/services/themes";
import { diffFromDefaults } from "@/templates/settings";

export const Route = createFileRoute("/seller/themes")({
  ssr: false,
  pendingComponent: CatalogSkeleton,
  component: ThemesPage,
});

function ThemesPage() {
  const queryClient = useQueryClient();
  const t = useSellerThemeData();
  const [category, setCategory] = useState("");
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const use = useMutation({
    mutationFn: (row: StoreTemplateRow) =>
      saveAppearance({
        storeId: t.store.id,
        templateId: row.id,
        // Keep the seller's customizations; they apply to every template.
        settings: t.current
          ? diffFromDefaults(t.current.template.defaults, t.current.settings)
          : {},
        name: null,
        description: null,
        logoUrl: null,
        bannerUrl: null,
      }),
    onSuccess: async (_d, row) => {
      toast.success(`${row.name} is now your store's theme`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["store-theme", t.store.id] }),
        queryClient.invalidateQueries({ queryKey: ["catalog"] }),
      ]);
    },
    onError: (e) => toast.error(themeError(e)),
  });

  if (t.isPending) return <CatalogSkeleton />;
  if (t.error || !t.data || !t.current)
    return (
      <div className="seller-page">
        <SellerPageHeader title="Themes" />
        <div role="alert" className="seller-empty">
          <h3>Themes could not be loaded.</h3>
          <p>{themeError(t.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void t.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );

  const data = t.data;
  const current = t.current;
  const currentCode = current.template.code;
  const categories = [
    ...new Set(t.templates.map((r) => r.category).filter((c): c is string => !!c)),
  ];
  const shown = t.templates.filter((r) => !category || r.category === category);
  const free = shown.filter((r) => !r.is_premium);
  const premium = shown.filter((r) => r.is_premium);

  const askUse = (row: StoreTemplateRow) =>
    setConfirm({
      title: `Use ${row.name}?`,
      description:
        "Your store switches to this template right away. Your colours, fonts, texts and section choices are kept.",
      confirmLabel: "Use this template",
      run: () => use.mutateAsync(row),
    });

  const card = (row: StoreTemplateRow) => {
    const tpl = templateFor(row);
    const unlocked = isUnlocked(row, t.grants);
    const isCurrent = row.code === currentCode;
    const price = formatPrice(row.price_cents, row.currency);
    return (
      <li key={row.id} className="theme-card" data-locked={!unlocked || undefined}>
        <TemplateMiniature
          template={tpl}
          // Each template in its own defaults so the library shows its real look.
          settings={tpl.defaults}
          data={data}
          scale={0.22}
        />
        <div className="theme-card-body">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{row.name}</h3>
            <Badge variant={row.is_premium ? "default" : "secondary"}>
              {row.is_premium ? "Premium" : "Free"}
            </Badge>
            {row.category && <span className="seller-hint">{row.category}</span>}
          </div>
          {row.description && <p className="seller-hint">{row.description}</p>}
          {row.is_premium && price && <p className="text-sm font-semibold">{price}</p>}
          {isCurrent ? (
            <Badge variant="outline" className="justify-self-start">
              Current theme
            </Badge>
          ) : unlocked ? (
            <Button
              size="sm"
              className="justify-self-start"
              disabled={use.isPending}
              onClick={() => askUse(row)}
            >
              Use this template
            </Button>
          ) : (
            <p className="theme-locked">
              <Lock size={14} aria-hidden />
              <span>{LOCKED_TEXT}</span>
            </p>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="seller-page">
      <SellerPageHeader title="Themes" description="Choose how your store looks to shoppers." />

      <section className="theme-current" aria-labelledby="current-theme">
        <TemplateMiniature
          template={current.template}
          settings={current.settings}
          data={data}
          scale={0.4}
        />
        <div className="grid content-start gap-3">
          <p className="seller-hint">Current theme</p>
          <h2 id="current-theme" className="text-xl font-semibold">
            {t.currentRow?.name ?? current.template.label}
          </h2>
          {!t.theme && (
            <p className="seller-hint">You haven't chosen a theme yet, so Classic is used.</p>
          )}
          <p className="seller-hint">
            Store status: <strong>{t.store.status}</strong>
            {t.store.status !== "published" && " — only you can preview it until it's published."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/seller/customize">
                <Paintbrush /> Customize
              </Link>
            </Button>
            <PreviewStoreButton slug={t.store.slug} published={t.store.status === "published"} />
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-4" aria-labelledby="theme-library">
        <div className="seller-panel-head">
          <div>
            <h2 id="theme-library">Theme library</h2>
            <p>Previews use your real store and products.</p>
          </div>
          {categories.length > 0 && (
            <label className="seller-field">
              <span className="sr-only">Filter by category</span>
              <select
                className="seller-select"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {!t.templates.length && <p className="seller-hint">No templates are available yet.</p>}
        {free.length > 0 && (
          <>
            <h3 className="font-semibold">Free templates</h3>
            <ul className="theme-grid">{free.map(card)}</ul>
          </>
        )}
        {premium.length > 0 && (
          <>
            <h3 className="font-semibold">Premium templates</h3>
            <ul className="theme-grid">{premium.map(card)}</ul>
          </>
        )}
      </section>
      <ConfirmDialog request={confirm} busy={use.isPending} onClose={() => setConfirm(null)} />
    </div>
  );
}
