import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Banknote } from "lucide-react";
import { stripeEnabled } from "@/services/checkout";
import {
  LOGO_FILE_HEIGHT,
  LOGO_FILE_WIDTH,
  logoSrc,
  PAYMENT_BRANDS,
  type PaymentBrand,
} from "@/lib/payment-logos";

/** The supplied logo, or a plain text badge when the file is missing or broken. */
function BrandLogo({ brand }: { brand: PaymentBrand }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    // A 404 before hydration fires `error` before React listens: check once.
    const img = ref.current;
    if (img?.complete && img.naturalWidth === 0) setFailed(true);
  }, []);
  return (
    <li className="pay-logo" data-testid="card-brand">
      {failed ? (
        <span className="pay-chip-text">{brand.name}</span>
      ) : (
        <img
          ref={ref}
          src={logoSrc(brand)}
          alt={brand.name}
          width={LOGO_FILE_WIDTH}
          height={LOGO_FILE_HEIGHT}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      )}
    </li>
  );
}

/** Only the payment methods this build really offers. */
export function PaymentMethods() {
  const { t } = useTranslation("footer");
  const cards = stripeEnabled();
  return (
    <section className="footer-payments" aria-labelledby="footer-payments-heading">
      <h2 id="footer-payments-heading" className="footer-heading">
        {t("paymentMethods")}
      </h2>
      <ul className="pay-list">
        <li className="pay-cod">
          <Banknote aria-hidden="true" />
          <span>{t("cod")}</span>
        </li>
        {cards && PAYMENT_BRANDS.map((b) => <BrandLogo key={b.id} brand={b} />)}
      </ul>
      {cards && (
        <p className="footer-payments-note" dir="auto">
          {t("stripeNote")}
        </p>
      )}
    </section>
  );
}
