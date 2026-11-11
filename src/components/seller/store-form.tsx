import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { StoreRow } from "@/data/db";
import { slugify, storeInputSchema, type StoreInput } from "@/services/seller";
import { SingleImageField } from "./image-fields";

export type StoreFiles = { logo: File | null; banner: File | null };

export function StoreForm({
  store,
  categoryNames,
  submitLabel,
  busy,
  onSubmit,
}: {
  store?: StoreRow | undefined;
  categoryNames: string[];
  submitLabel: string;
  busy: boolean;
  onSubmit: (values: StoreInput, files: StoreFiles) => Promise<unknown>;
}) {
  const [values, setValues] = useState<Required<StoreInput>>({
    name: store?.name ?? "",
    description: store?.description ?? "",
    category: store?.category ?? "",
    location: store?.location ?? "",
  });
  const [files, setFiles] = useState<StoreFiles>({ logo: null, banner: null });
  const [errors, setErrors] = useState<Partial<Record<keyof StoreInput, string>>>({});
  const set = (key: keyof StoreInput) => (value: string) =>
    setValues((v) => ({ ...v, [key]: value }));
  const options = [
    ...new Set([...categoryNames, "Other", ...(store?.category ? [store.category] : [])]),
  ];
  const slug = slugify(values.name);

  return (
    <form
      className="seller-form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = storeInputSchema.safeParse(values);
        if (!parsed.success) {
          const fieldErrors = parsed.error.flatten().fieldErrors;
          setErrors(Object.fromEntries(Object.entries(fieldErrors).map(([k, v]) => [k, v?.[0]])));
          return;
        }
        setErrors({});
        try {
          await onSubmit(values, files);
          setFiles({ logo: null, banner: null });
        } catch {
          /* The caller shows the error toast. */
        }
      }}
    >
      <div className="seller-field">
        <Label htmlFor="store-name">Store name</Label>
        <Input
          id="store-name"
          value={values.name}
          onChange={(e) => set("name")(e.target.value)}
          aria-invalid={!!errors.name}
          aria-describedby="store-name-hint"
          maxLength={80}
          required
        />
        <p id="store-name-hint" className={errors.name ? "seller-error" : "seller-hint"}>
          {errors.name ??
            (store
              ? `Store address: /store/${store.slug}`
              : slug
                ? `Store address: /store/${slug} (a number is added if it's taken)`
                : "Your store address is created from the name.")}
        </p>
      </div>
      <div className="seller-field">
        <Label htmlFor="store-description">Description</Label>
        <Textarea
          id="store-description"
          rows={4}
          maxLength={1000}
          value={values.description ?? ""}
          onChange={(e) => set("description")(e.target.value)}
        />
      </div>
      <div className="seller-form-row">
        <div className="seller-field">
          <Label htmlFor="store-category">Category</Label>
          <select
            id="store-category"
            className="seller-select"
            value={values.category ?? ""}
            onChange={(e) => set("category")(e.target.value)}
          >
            <option value="">Choose a category</option>
            {options.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="seller-field">
          <Label htmlFor="store-location">Location</Label>
          <Input
            id="store-location"
            value={values.location ?? ""}
            maxLength={160}
            placeholder="City, country"
            onChange={(e) => set("location")(e.target.value)}
          />
        </div>
      </div>
      <div className="seller-form-row">
        <SingleImageField
          id="store-logo"
          label="Logo"
          hint="Square, up to 5 MB"
          variant="logo"
          currentUrl={store?.logo_url ?? null}
          file={files.logo}
          onChange={(logo) => setFiles((f) => ({ ...f, logo }))}
        />
        <SingleImageField
          id="store-banner"
          label="Banner"
          hint="Wide (about 5:1), up to 5 MB"
          variant="banner"
          currentUrl={store?.banner_url ?? null}
          file={files.banner}
          onChange={(banner) => setFiles((f) => ({ ...f, banner }))}
        />
      </div>
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
