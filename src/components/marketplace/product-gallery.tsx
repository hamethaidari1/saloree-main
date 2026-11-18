import { useTranslation } from "react-i18next";
import { thumbOrFull, thumbUrl } from "@/lib/image-optimize";
import { useRef, useState, type KeyboardEvent } from "react";
import { useLocale } from "@/i18n/hooks";
import { dirFor } from "@/i18n/locales";

/**
 * Product photos: the selected one large, every photo as a thumbnail below.
 * Thumbnails are a toolbar: one Tab stop, arrow keys (mirrored in RTL),
 * Home / End to move; the focused thumbnail is shown at once.
 */
export function ProductGallery({ title, images }: { title: string; images: string[] }) {
  const { t } = useTranslation("product");
  const rtl = dirFor(useLocale()) === "rtl";
  const [index, setIndex] = useState(0);
  const thumbs = useRef<(HTMLButtonElement | null)[]>([]);
  const count = images.length;
  const current = images[Math.min(index, count - 1)] ?? images[0];

  const go = (i: number) => {
    const next = (i + count) % count;
    setIndex(next);
    thumbs.current[next]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1, ArrowDown: 1, ArrowUp: -1 }[
      e.key as "ArrowRight"
    ];
    if (step) go(index + step);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(count - 1);
    else return;
    e.preventDefault();
  };

  return (
    <div className="detail-gallery">
      <div className="detail-photo">
        <img
          src={current}
          alt={count > 1 ? t("gallery.imageAlt", { title, n: index + 1, count }) : title}
          width="384"
          height="512"
          fetchPriority={index === 0 ? "high" : "auto"}
        />
      </div>
      {count > 1 && (
        <div
          role="toolbar"
          aria-label={t("gallery.label")}
          aria-orientation="horizontal"
          className="detail-thumbnails"
          onKeyDown={onKeyDown}
        >
          {images.map((src, i) => (
            <button
              key={src}
              ref={(el) => {
                thumbs.current[i] = el;
              }}
              type="button"
              aria-label={t("gallery.show", { n: i + 1, count })}
              aria-pressed={i === index}
              tabIndex={i === index ? 0 : -1}
              onClick={() => setIndex(i)}
            >
              {/* Small and right under the photo: load at once (lazy left gaps in the strip). */}
              <img
                src={thumbUrl(src)}
                onError={thumbOrFull(src)}
                alt=""
                width="72"
                height="72"
                decoding="async"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
