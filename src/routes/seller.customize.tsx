import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link, useBlocker } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Monitor, RotateCcw, Smartphone, Tablet } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/marketplace/confirm-dialog";
import { CatalogSkeleton } from "@/components/marketplace/shared";
import {
  buildSaveArgs,
  draftFromSaved,
  isDirty,
  nameError,
  previewSettings,
  resetSection,
  settingsErrors,
  SECTION_KEYS,
  type CustomizeDraft,
  type ImageDraft,
} from "@/components/seller/customize-state";
import { SingleImageField } from "@/components/seller/image-fields";
import { useSeller } from "@/components/seller/seller-context";
import { PreviewStoreButton, useSellerThemeData } from "@/components/seller/theme-data";
import { sellerService } from "@/services/seller";
import { saveAppearance, themeError } from "@/services/themes";
import type { TemplateData } from "@/templates/data";
import type { TemplateDefinition } from "@/templates/registry";
import { TemplateView } from "@/templates/render";
import {
  CORNER_STYLES,
  contrastWarnings,
  FONT_KEYS,
  FONT_LABELS,
  GRID_COLUMNS,
  HEX_COLOR,
  type SettingKey,
  type ThemeSettings,
} from "@/templates/settings";

export const Route = createFileRoute("/seller/customize")({
  ssr: false,
  pendingComponent: CatalogSkeleton,
  component: CustomizePage,
});

function CustomizePage() {
  const t = useSellerThemeData();
  if (t.isPending) return <CatalogSkeleton />;
  if (t.error || !t.data || !t.current)
    return (
      <div className="seller-page">
        <div role="alert" className="seller-empty">
          <h3>The editor could not be loaded.</h3>
          <p>{themeError(t.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void t.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  // The template row id is needed to save; a store with no theme uses Classic's.
  const templateId =
    t.theme?.templateId ?? t.templates.find((r) => r.code === t.current?.template.code)?.id ?? null;
  return (
    <Editor
      // New editor state only for another store or template. After Save the editor
      // updates its own baseline, so refetches can't swap in a half-updated state.
      key={`${t.store.id}:${t.theme?.templateId ?? "none"}`}
      template={t.current.template}
      savedSettings={t.current.settings}
      templateId={templateId}
      templateName={t.currentRow?.name ?? t.current.template.label}
      data={t.data}
    />
  );
}

type Device = "desktop" | "tablet" | "mobile";
const DEVICES: { id: Device; label: string; width: string; icon: typeof Monitor }[] = [
  { id: "desktop", label: "Desktop", width: "100%", icon: Monitor },
  { id: "tablet", label: "Tablet", width: "768px", icon: Tablet },
  { id: "mobile", label: "Mobile", width: "375px", icon: Smartphone },
];

/** Object URL for a chosen-but-not-uploaded image (preview only), revoked on change. */
function usePreviewUrl(img: ImageDraft) {
  const [url, setUrl] = useState<string>(img.url);
  useEffect(() => {
    if (!img.file) return setUrl(img.url);
    const objectUrl = URL.createObjectURL(img.file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [img.file, img.url]);
  return url || null;
}

function Editor({
  template,
  savedSettings,
  templateId,
  templateName,
  data,
}: {
  template: TemplateDefinition;
  savedSettings: ThemeSettings;
  templateId: string | null;
  templateName: string;
  data: TemplateData;
}) {
  const { store, storesKey } = useSeller();
  const queryClient = useQueryClient();
  const [baseline, setBaseline] = useState<CustomizeDraft>(() =>
    draftFromSaved(store, savedSettings),
  );
  const [draft, setDraft] = useState<CustomizeDraft>(baseline);
  const [device, setDevice] = useState<Device>("desktop");
  const [status, setStatus] = useState<{ kind: "saved" } | { kind: "error"; text: string } | null>(
    null,
  );
  const defaults = template.defaults;
  const dirty = isDirty(draft, baseline);
  const errors = settingsErrors(draft.settings);
  const nameProblem = nameError(draft.name);
  const invalid = Object.keys(errors).length > 0 || !!nameProblem;
  const preview = previewSettings(defaults, draft);
  const warnings = contrastWarnings(preview);

  const set = <K extends SettingKey>(key: K, value: ThemeSettings[K]) => {
    setStatus(null);
    setDraft((d) => ({ ...d, settings: { ...d.settings, [key]: value } }));
  };
  const patch = (p: Partial<CustomizeDraft>) => {
    setStatus(null);
    setDraft((d) => ({ ...d, ...p }));
  };
  const reset = (section: keyof typeof SECTION_KEYS) =>
    setDraft((d) => ({ ...d, settings: resetSection(d.settings, defaults, section) }));

  // Live preview data: the real store with the unsaved identity edits applied.
  const logoUrl = usePreviewUrl(draft.logo);
  const bannerUrl = usePreviewUrl(draft.banner);
  const previewData: TemplateData = useMemo(
    () => ({
      ...data,
      store: {
        ...data.store,
        name: draft.name.trim() || data.store.name,
        description: draft.description,
        logo: logoUrl,
        banner: bannerUrl,
      },
    }),
    [data, draft.name, draft.description, logoUrl, bannerUrl],
  );

  const save = useMutation({
    mutationFn: async () => {
      if (!templateId) throw new Error("Templates aren't available yet, so this can't be saved.");
      const uploaded: { logo?: string; banner?: string } = {};
      if (draft.logo.file)
        uploaded.logo = await sellerService.uploadStoreImage("logo", draft.logo.file);
      if (draft.banner.file)
        uploaded.banner = await sellerService.uploadStoreImage("banner", draft.banner.file);
      const args = buildSaveArgs(draft, baseline, defaults, uploaded);
      await saveAppearance({ storeId: store.id, templateId, ...args });
      return uploaded;
    },
    onSuccess: async (uploaded) => {
      const saved: CustomizeDraft = {
        ...draft,
        name: draft.name.trim(),
        description: draft.description.trim(),
        logo: { file: null, url: uploaded.logo ?? draft.logo.url },
        banner: { file: null, url: uploaded.banner ?? draft.banner.url },
      };
      setBaseline(saved);
      setDraft(saved);
      setStatus({ kind: "saved" });
      toast.success("Your store's look is saved");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["store-theme", store.id] }),
        queryClient.invalidateQueries({ queryKey: storesKey }),
        queryClient.invalidateQueries({ queryKey: ["catalog"] }),
      ]);
    },
    onError: (e) => setStatus({ kind: "error", text: themeError(e) }),
  });

  // Warn before leaving with unsaved changes (in-app navigation and tab close).
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !save.isPending,
    enableBeforeUnload: () => dirty,
    withResolver: true,
  });

  return (
    <div className="customize">
      <div className="customize-bar">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">Customize · {templateName}</h1>
          <p className="seller-hint">
            <Link to="/seller/themes" className="underline-offset-2 hover:underline">
              Change template
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty ? (
            <Badge variant="secondary" role="status">
              Unsaved changes
            </Badge>
          ) : status?.kind === "saved" ? (
            <span role="status" className="flex items-center gap-1 text-sm text-primary">
              <Check size={14} aria-hidden /> Saved
            </span>
          ) : null}
          <PreviewStoreButton slug={store.slug} published={store.status === "published"} />
          <Button
            variant="outline"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setDraft(baseline);
              setStatus(null);
            }}
          >
            Discard
          </Button>
          <Button disabled={!dirty || invalid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
      {status?.kind === "error" && (
        <p role="alert" className="customize-error">
          {status.text}
        </p>
      )}

      <div className="customize-body">
        <div className="customize-panel" aria-label="Theme settings">
          <Section title="Store identity" onReset={() => patch({ ...pickIdentity(baseline) })}>
            <Field label="Store name" error={nameProblem}>
              {(id) => (
                <Input
                  id={id}
                  value={draft.name}
                  maxLength={80}
                  aria-invalid={!!nameProblem}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              )}
            </Field>
            <Field label="Description">
              {(id) => (
                <Textarea
                  id={id}
                  rows={3}
                  maxLength={1000}
                  value={draft.description}
                  onChange={(e) => patch({ description: e.target.value })}
                />
              )}
            </Field>
            {(["logo", "banner"] as const).map((kind) => (
              <div key={kind} className="grid gap-1">
                <SingleImageField
                  id={`customize-${kind}`}
                  label={kind === "logo" ? "Logo" : "Banner"}
                  hint={kind === "logo" ? "Square, up to 5 MB" : "Wide (about 5:1), up to 5 MB"}
                  variant={kind}
                  currentUrl={draft[kind].url || null}
                  file={draft[kind].file}
                  onChange={(file) => patch({ [kind]: { ...draft[kind], file } })}
                />
                {(draft[kind].url || draft[kind].file) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="justify-self-start"
                    onClick={() => patch({ [kind]: { file: null, url: "" } })}
                  >
                    Remove {kind}
                  </Button>
                )}
              </div>
            ))}
          </Section>

          <Section title="Colors" onReset={() => reset("colors")}>
            {(["primary", "accent", "background", "text"] as const).map((key) => (
              <ColorField
                key={key}
                label={key === "text" ? "Text" : key[0]!.toUpperCase() + key.slice(1)}
                value={draft.settings[key]}
                error={errors[key]}
                onChange={(v) => set(key, v)}
              />
            ))}
            {warnings.length > 0 && (
              <div className="customize-warning" role="status">
                <AlertTriangle size={16} aria-hidden />
                <div>
                  {warnings.map((w) => (
                    <p key={w.pair}>
                      {w.pair} has a contrast of {w.ratio}:1 — below the WCAG AA minimum of 4.5:1.
                      Some shoppers may find it hard to read. You can still save.
                    </p>
                  ))}
                </div>
              </div>
            )}
          </Section>

          <Section title="Typography" onReset={() => reset("typography")}>
            {(["font_heading", "font_body"] as const).map((key) => (
              <Field key={key} label={key === "font_heading" ? "Headings" : "Body text"}>
                {(id) => (
                  <select
                    id={id}
                    className="seller-select"
                    value={draft.settings[key]}
                    onChange={(e) => set(key, e.target.value as ThemeSettings[typeof key])}
                  >
                    {FONT_KEYS.map((f) => (
                      <option key={f} value={f}>
                        {FONT_LABELS[f]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            ))}
          </Section>

          <Section title="Layout" onReset={() => reset("layout")}>
            <Field label="Products per row (desktop)">
              {(id) => (
                <select
                  id={id}
                  className="seller-select"
                  value={draft.settings.grid_columns}
                  onChange={(e) =>
                    set("grid_columns", Number(e.target.value) as ThemeSettings["grid_columns"])
                  }
                >
                  {GRID_COLUMNS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Corners">
              {(id) => (
                <select
                  id={id}
                  className="seller-select"
                  value={draft.settings.corner_style}
                  onChange={(e) =>
                    set("corner_style", e.target.value as ThemeSettings["corner_style"])
                  }
                >
                  {CORNER_STYLES.map((c) => (
                    <option key={c} value={c}>
                      {c[0]!.toUpperCase() + c.slice(1)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </Section>

          <Section title="Hero" onReset={() => reset("hero")}>
            <TextField
              label="Title"
              hint={`Empty = your store name (${store.name}).`}
              max={80}
              value={draft.settings.hero_title}
              error={errors.hero_title}
              onChange={(v) => set("hero_title", v)}
            />
            <TextField
              label="Subtitle"
              max={200}
              multiline
              value={draft.settings.hero_subtitle}
              error={errors.hero_subtitle}
              onChange={(v) => set("hero_subtitle", v)}
            />
            <TextField
              label="Button label"
              hint="Empty = no button."
              max={30}
              value={draft.settings.hero_cta_label}
              error={errors.hero_cta_label}
              onChange={(v) => set("hero_cta_label", v)}
            />
            <TextField
              label="Hero image link"
              hint="Optional https:// image. Empty = your banner."
              max={500}
              value={draft.settings.hero_image_url}
              error={errors.hero_image_url}
              onChange={(v) => set("hero_image_url", v)}
            />
          </Section>

          <Section title="Announcement bar" onReset={() => reset("announcement")}>
            <Toggle
              label="Show the announcement bar"
              checked={draft.settings.show_announcement}
              onChange={(v) => set("show_announcement", v)}
            />
            <TextField
              label="Announcement"
              max={120}
              value={draft.settings.announcement_text}
              error={errors.announcement_text}
              onChange={(v) => set("announcement_text", v)}
            />
          </Section>

          <Section title="Page sections" onReset={() => reset("sections")}>
            <Toggle
              label="Featured products"
              checked={draft.settings.show_featured}
              onChange={(v) => set("show_featured", v)}
            />
            <Toggle
              label="Categories"
              checked={draft.settings.show_categories}
              onChange={(v) => set("show_categories", v)}
            />
            <Toggle
              label="About (uses your description)"
              checked={draft.settings.show_about}
              onChange={(v) => set("show_about", v)}
            />
          </Section>
        </div>

        <div className="customize-preview">
          <div role="radiogroup" aria-label="Preview width" className="seller-segmented">
            {DEVICES.map((d) => (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={device === d.id}
                onClick={() => setDevice(d.id)}
              >
                <d.icon size={14} aria-hidden className="inline" /> {d.label}
              </button>
            ))}
          </div>
          <div className="customize-stage">
            <div
              className="customize-frame"
              style={{ inlineSize: DEVICES.find((d) => d.id === device)!.width }}
              aria-label={`Live preview, ${device} width`}
            >
              <TemplateView
                template={template}
                settings={preview}
                data={previewData}
                mode="preview"
              />
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        request={
          blocker.status === "blocked"
            ? {
                title: "Leave without saving?",
                description: "Your unsaved changes to the store's look will be lost.",
                confirmLabel: "Leave",
                cancelLabel: "Stay",
                destructive: true,
                run: async () => blocker.proceed?.(),
              }
            : null
        }
        busy={false}
        onClose={() => blocker.status === "blocked" && blocker.reset?.()}
      />
    </div>
  );
}

const pickIdentity = (d: CustomizeDraft) => ({
  name: d.name,
  description: d.description,
  logo: d.logo,
  banner: d.banner,
});

function Section({
  title,
  onReset,
  children,
}: {
  title: string;
  onReset: () => void;
  children: ReactNode;
}) {
  return (
    <details className="customize-section" open>
      <summary>
        <span>{title}</span>
      </summary>
      <div className="grid gap-4">
        {children}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={onReset}
        >
          <RotateCcw />{" "}
          {title === "Store identity" ? "Undo identity changes" : "Reset to template defaults"}
        </Button>
      </div>
    </details>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | null | undefined;
  hint?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="seller-field">
      <Label htmlFor={id}>{label}</Label>
      {children(id)}
      {error ? (
        <p className="seller-error">{error}</p>
      ) : hint ? (
        <p className="seller-hint">{hint}</p>
      ) : null}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  max,
  error,
  hint,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  max: number;
  error?: string | undefined;
  hint?: string;
  multiline?: boolean;
}) {
  return (
    <Field label={label} error={error} hint={hint ?? `${value.length}/${max}`}>
      {(id) =>
        multiline ? (
          <Textarea
            id={id}
            rows={2}
            value={value}
            aria-invalid={!!error}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <Input
            id={id}
            value={value}
            aria-invalid={!!error}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      }
    </Field>
  );
}

function ColorField({
  label,
  value,
  error,
  onChange,
}: {
  label: string;
  value: string;
  error?: string | undefined;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="seller-field">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          className="customize-swatch"
          // The picker only accepts #rrggbb; while the text is invalid it shows the last good colour.
          value={HEX_COLOR.test(value) ? value.toLowerCase() : "#000000"}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
        <Input
          id={id}
          value={value}
          maxLength={7}
          spellCheck={false}
          className="font-mono"
          aria-invalid={!!error}
          onChange={(e) => onChange(e.target.value.trim())}
        />
      </div>
      {error && <p className="seller-error">{error}</p>}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
