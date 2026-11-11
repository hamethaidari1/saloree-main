import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CategoryRow } from "@/data/db";
import {
  PRODUCT_STATUSES,
  productInputSchema,
  slugify,
  type ImageItem,
  type ProductInput,
  type SellerProduct,
} from "@/services/seller";
import { ProductImagesField } from "./image-fields";

type FormValues = {
  title: string;
  slug: string;
  description: string;
  price: string;
  compare_price: string;
  stock: string;
  category_id: string;
  status: (typeof PRODUCT_STATUSES)[number];
};
type FieldErrors = Partial<Record<keyof FormValues, string>>;

function initialImages(product?: SellerProduct): ImageItem[] {
  if (!product) return [];
  const urls = product.product_images.map((i) => i.image_url);
  // Older products may only have featured_image set.
  if (product.featured_image && !urls.includes(product.featured_image))
    urls.unshift(product.featured_image);
  return urls.map((url) => ({ kind: "existing", key: url, url }));
}

export function ProductForm({
  product,
  categories,
  busy,
  onSubmit,
  onCancel,
}: {
  product?: SellerProduct | undefined;
  categories: CategoryRow[];
  busy: boolean;
  onSubmit: (values: ProductInput, images: ImageItem[]) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<FormValues>({
    title: product?.title ?? "",
    slug: product?.slug ?? "",
    description: product?.description ?? "",
    price: product ? String(product.price) : "",
    compare_price: product?.compare_price != null ? String(product.compare_price) : "",
    stock: product ? String(product.stock) : "1",
    category_id: product?.category_id ?? "",
    status: product?.status === "active" ? "active" : "draft",
  });
  const [slugEdited, setSlugEdited] = useState(!!product);
  const [images, setImages] = useState<ImageItem[]>(() => initialImages(product));
  const [errors, setErrors] = useState<FieldErrors>({});
  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));
  const field = (key: keyof FormValues) => ({
    id: `product-${key}`,
    "aria-invalid": !!errors[key],
    "aria-describedby": errors[key] ? `product-${key}-error` : undefined,
  });
  const error = (key: keyof FormValues) =>
    errors[key] && (
      <p id={`product-${key}-error`} className="seller-error">
        {errors[key]}
      </p>
    );

  return (
    <form
      className="seller-form"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        const parsed = productInputSchema.safeParse(values);
        if (!parsed.success) {
          const fe = parsed.error.flatten().fieldErrors;
          setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0]])));
          return;
        }
        if (values.status === "active" && !images.length) {
          setErrors({ status: "Add at least one image before making the product active." });
          return;
        }
        setErrors({});
        await onSubmit(parsed.data, images).catch(() => {
          /* The caller shows the error toast. */
        });
      }}
    >
      <div className="seller-field">
        <Label htmlFor="product-title">Title</Label>
        <Input
          {...field("title")}
          value={values.title}
          maxLength={200}
          onChange={(e) => {
            set("title", e.target.value);
            if (!slugEdited) set("slug", slugify(e.target.value));
          }}
        />
        {error("title")}
      </div>
      <div className="seller-field">
        <Label htmlFor="product-slug">Slug</Label>
        <Input
          {...field("slug")}
          value={values.slug}
          maxLength={90}
          onChange={(e) => {
            setSlugEdited(true);
            set("slug", e.target.value.toLowerCase());
          }}
          onBlur={() => set("slug", slugify(values.slug))}
        />
        {error("slug") ?? (
          <p className="seller-hint">Must be unique. A number is added if it's already taken.</p>
        )}
      </div>
      <div className="seller-field">
        <Label htmlFor="product-description">Description</Label>
        <Textarea
          {...field("description")}
          rows={5}
          maxLength={5000}
          value={values.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </div>
      <div className="seller-form-row three">
        <div className="seller-field">
          <Label htmlFor="product-price">Price (USD)</Label>
          <Input
            {...field("price")}
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={values.price}
            onChange={(e) => set("price", e.target.value)}
          />
          {error("price")}
        </div>
        <div className="seller-field">
          <Label htmlFor="product-compare_price">Compare-at price</Label>
          <Input
            {...field("compare_price")}
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            placeholder="Optional"
            value={values.compare_price}
            onChange={(e) => set("compare_price", e.target.value)}
          />
          {error("compare_price")}
        </div>
        <div className="seller-field">
          <Label htmlFor="product-stock">Stock</Label>
          <Input
            {...field("stock")}
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={values.stock}
            onChange={(e) => set("stock", e.target.value)}
          />
          {error("stock")}
        </div>
      </div>
      <div className="seller-form-row">
        <div className="seller-field">
          <Label htmlFor="product-category_id">Category</Label>
          <select
            {...field("category_id")}
            className="seller-select"
            value={values.category_id}
            onChange={(e) => set("category_id", e.target.value)}
          >
            <option value="">Choose a category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {error("category_id")}
        </div>
        <div className="seller-field">
          <Label htmlFor="product-status">Status</Label>
          <select
            {...field("status")}
            className="seller-select"
            value={values.status}
            onChange={(e) => set("status", e.target.value as FormValues["status"])}
          >
            <option value="draft">Draft — hidden from shoppers</option>
            <option value="active">Active — visible once your store is published</option>
          </select>
          {error("status")}
        </div>
      </div>
      <ProductImagesField items={images} onChange={setImages} />
      <div className="seller-form-actions">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : product ? "Save changes" : "Add product"}
        </Button>
      </div>
    </form>
  );
}
