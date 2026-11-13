import { useEffect, useRef, useState } from "react";
import { ImagePlus, Star, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { IMAGE_ACCEPT, validateImage, type ImageItem } from "@/services/seller";

const MAX_PRODUCT_IMAGES = 10;

/** Previews a picked File, falling back to the saved URL. */
function usePreview(file: File | null, fallback: string | null) {
  const [url, setUrl] = useState<string | null>(fallback);
  useEffect(() => {
    if (!file) return setUrl(fallback);
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file, fallback]);
  return url;
}

export function SingleImageField({
  id,
  label,
  hint,
  currentUrl,
  file,
  onChange,
  variant,
}: {
  id: string;
  label: string;
  hint: string;
  currentUrl: string | null;
  file: File | null;
  onChange: (file: File | null) => void;
  variant: "logo" | "banner";
}) {
  const preview = usePreview(file, currentUrl);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="seller-image-field">
      <span className="seller-label">{label}</span>
      <div className={`seller-image-preview ${variant}`}>
        {preview ? <img src={preview} alt={`${label} preview`} /> : <ImagePlus aria-hidden />}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
          {preview ? "Replace" : "Upload"}
        </Button>
        {file && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
            Undo
          </Button>
        )}
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      <input
        ref={input}
        id={id}
        type="file"
        accept={IMAGE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label={label}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (!picked) return;
          try {
            validateImage(picked);
            onChange(picked);
          } catch (err) {
            toast.error((err as Error).message);
          }
        }}
      />
    </div>
  );
}

export function ProductImagesField({
  items,
  onChange,
}: {
  items: ImageItem[];
  onChange: (items: ImageItem[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(items);
  latest.current = items;
  // Release object URLs for unsaved files when the form closes.
  useEffect(
    () => () => {
      for (const i of latest.current) if (i.kind === "new") URL.revokeObjectURL(i.preview);
    },
    [],
  );

  const remove = (key: string) => {
    const item = items.find((i) => i.key === key);
    if (item?.kind === "new") URL.revokeObjectURL(item.preview);
    onChange(items.filter((i) => i.key !== key));
  };
  const makeCover = (key: string) => {
    const item = items.find((i) => i.key === key);
    if (item) onChange([item, ...items.filter((i) => i.key !== key)]);
  };

  return (
    <div className="seller-image-field">
      <span className="seller-label">Images</span>
      <ul className="seller-image-grid">
        {items.map((item, index) => (
          <li key={item.key}>
            <img
              src={item.kind === "new" ? item.preview : item.url}
              alt={`Product image ${index + 1}`}
            />
            {index === 0 ? (
              <span className="seller-cover-tag">Cover</span>
            ) : (
              <button
                type="button"
                className="seller-thumb-action left"
                aria-label={`Make image ${index + 1} the cover`}
                title="Make cover"
                onClick={() => makeCover(item.key)}
              >
                <Star size={13} />
              </button>
            )}
            <button
              type="button"
              className="seller-thumb-action right"
              aria-label={`Remove image ${index + 1}`}
              title="Remove"
              onClick={() => remove(item.key)}
            >
              <X size={13} />
            </button>
          </li>
        ))}
        {items.length < MAX_PRODUCT_IMAGES && (
          <li>
            <button
              type="button"
              className="seller-image-add"
              onClick={() => input.current?.click()}
            >
              <ImagePlus size={18} />
              Add
            </button>
          </li>
        )}
      </ul>
      <span className="text-xs text-muted-foreground">
        The first image is the cover. PNG, JPG, WebP or GIF, up to 5 MB each, max{" "}
        {MAX_PRODUCT_IMAGES}.
      </span>
      <input
        ref={input}
        type="file"
        multiple
        accept={IMAGE_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-label="Add product images"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          const added: ImageItem[] = [];
          for (const file of files.slice(0, MAX_PRODUCT_IMAGES - items.length)) {
            try {
              validateImage(file);
              added.push({
                kind: "new",
                key: crypto.randomUUID(),
                file,
                preview: URL.createObjectURL(file),
              });
            } catch (err) {
              toast.error((err as Error).message);
            }
          }
          if (files.length > MAX_PRODUCT_IMAGES - items.length)
            toast.info(`Only ${MAX_PRODUCT_IMAGES} images per product.`);
          if (added.length) onChange([...items, ...added]);
        }}
      />
    </div>
  );
}
