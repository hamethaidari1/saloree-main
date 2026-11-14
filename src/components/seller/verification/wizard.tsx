import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, Check, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { countryNameEn } from "@/lib/iso-countries";
import {
  DOCUMENT_LABEL,
  ID_DOC_LABEL,
  ID_DOC_TYPES,
  isEditable,
  missingDocuments,
  resumeStep,
  stepComplete,
  stepErrors,
  STEPS,
  validateForm,
  type FieldErrors,
  type FormField,
  type StepId,
  type VerificationForm,
  type VerificationStatus,
} from "@/lib/seller-verification";
import {
  errorText,
  profileToForm,
  sellerVerificationService,
  statusOf,
  verificationKeys,
  type SellerDocument,
  type SellerProfile,
} from "@/services/seller-verification";
import { CountryMultiSelect, CountrySelect, Field } from "./fields";
import { DocumentsStep } from "./documents";

const stepIndex = (id: StepId) => STEPS.findIndex((s) => s.id === id);

/** Progress: every step, the current one marked, earlier ones clickable. */
function Progress({
  current,
  reachable,
  done,
  onGo,
}: {
  current: StepId;
  reachable: number;
  done: (id: StepId) => boolean;
  onGo: (id: StepId) => void;
}) {
  const at = stepIndex(current);
  return (
    <nav aria-label="Verification steps">
      <p className="seller-hint">
        Step {at + 1} of {STEPS.length}
      </p>
      <ol className="verify-steps">
        {STEPS.map((s, i) => (
          <li key={s.id} data-state={s.id === current ? "current" : done(s.id) ? "done" : "todo"}>
            <button
              type="button"
              disabled={i > reachable}
              aria-current={s.id === current ? "step" : undefined}
              onClick={() => onGo(s.id)}
            >
              <span className="verify-step-dot" aria-hidden>
                {done(s.id) && s.id !== current ? <Check size={14} /> : i + 1}
              </span>
              <span className="verify-step-label">{s.label}</span>
              {done(s.id) && s.id !== current && <span className="sr-only"> (complete)</span>}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function TypeCards({
  value,
  onChange,
  disabled,
  error,
}: {
  value: VerificationForm["seller_type"];
  onChange: (v: "individual" | "business") => void;
  disabled: boolean;
  error?: string | undefined;
}) {
  const cards = [
    {
      id: "individual" as const,
      icon: User,
      title: "Individual",
      text: "You sell in your own name, for example things you make or collect.",
    },
    {
      id: "business" as const,
      icon: Building2,
      title: "Business",
      text: "You sell through a registered company or trade name.",
    },
  ];
  return (
    <fieldset className="grid gap-3" aria-describedby={error ? "seller_type-error" : undefined}>
      <legend className="verify-label">How do you sell?</legend>
      <p className="seller-hint">
        You do not need a company to sell on Saloree. Individuals can sell too.
      </p>
      <div className="verify-type-cards">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <label key={c.id} className="verify-type-card" data-selected={value === c.id}>
              <input
                type="radio"
                name="seller_type"
                value={c.id}
                checked={value === c.id}
                disabled={disabled}
                onChange={() => onChange(c.id)}
              />
              <Icon aria-hidden />
              <span className="verify-type-title">{c.title}</span>
              <span className="seller-hint">{c.text}</span>
            </label>
          );
        })}
      </div>
      {error && (
        <p id="seller_type-error" className="seller-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}

interface StepProps {
  values: VerificationForm;
  set: <K extends FormField>(key: K, value: VerificationForm[K]) => void;
  errors: FieldErrors;
  disabled: boolean;
}

function TextInput({
  name,
  label,
  props,
  optional,
  hint,
  type = "text",
  autoComplete,
  inputMode,
  maxLength,
}: {
  name: FormField;
  label: string;
  props: StepProps;
  optional?: boolean;
  hint?: ReactNode;
  type?: string;
  autoComplete?: string;
  inputMode?: "text" | "tel" | "email";
  maxLength?: number;
}) {
  const { values, set, errors, disabled } = props;
  return (
    <Field id={`v-${name}`} label={label} optional={optional} hint={hint} error={errors[name]}>
      {(aria) => (
        <Input
          {...aria}
          type={type}
          value={values[name] as string}
          disabled={disabled}
          autoComplete={autoComplete ?? "off"}
          inputMode={inputMode}
          maxLength={maxLength}
          spellCheck={false}
          onChange={(e) => set(name, e.target.value as never)}
        />
      )}
    </Field>
  );
}

function CountryField({
  name,
  label,
  props,
  optional,
  hint,
}: {
  name: FormField;
  label: string;
  props: StepProps;
  optional?: boolean;
  hint?: ReactNode;
}) {
  const { values, set, errors, disabled } = props;
  return (
    <Field id={`v-${name}`} label={label} optional={optional} hint={hint} error={errors[name]}>
      {(aria) => (
        <CountrySelect
          {...aria}
          value={values[name] as string}
          disabled={disabled}
          onChange={(c) => set(name, c as never)}
        />
      )}
    </Field>
  );
}

function IdentityStep(p: StepProps) {
  const business = p.values.seller_type === "business";
  if (business)
    return (
      <div className="seller-form">
        <TextInput name="company_name" label="Company name" props={p} maxLength={160} />
        <div className="seller-form-row">
          <TextInput
            name="company_reg_number"
            label="Registration number"
            props={p}
            maxLength={40}
          />
          <CountryField name="company_country" label="Country of registration" props={p} />
        </div>
        <TextInput
          name="full_name"
          label="Name of the representative"
          hint="The person who acts for the company, as written on their ID."
          props={p}
          autoComplete="name"
          maxLength={120}
        />
      </div>
    );
  return (
    <div className="seller-form">
      <TextInput
        name="full_name"
        label="Full name (as on your ID)"
        props={p}
        autoComplete="name"
        maxLength={120}
      />
      <TextInput
        name="birth_date"
        label="Date of birth"
        hint="You must be at least 18 to sell."
        type="date"
        autoComplete="bday"
        props={p}
      />
      <div className="seller-form-row">
        <Field id="v-id_doc_type" label="ID document" error={p.errors.id_doc_type}>
          {(aria) => (
            <select
              {...aria}
              className="seller-select"
              value={p.values.id_doc_type}
              disabled={p.disabled}
              onChange={(e) =>
                p.set("id_doc_type", e.target.value as VerificationForm["id_doc_type"])
              }
            >
              <option value="">Choose a document</option>
              {ID_DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ID_DOC_LABEL[t]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <TextInput name="id_doc_number" label="Document number" props={p} maxLength={40} />
      </div>
      <CountryField name="id_doc_country" label="Issuing country" props={p} />
    </div>
  );
}

function AddressStep(p: StepProps) {
  return (
    <div className="seller-form">
      <CountryField name="country" label="Country" props={p} />
      <TextInput
        name="address_line1"
        label="Street address"
        props={p}
        autoComplete="address-line1"
        maxLength={160}
      />
      <TextInput
        name="address_line2"
        label="Address line 2"
        optional
        props={p}
        autoComplete="address-line2"
        maxLength={160}
      />
      <div className="seller-form-row">
        <TextInput
          name="city"
          label="City"
          props={p}
          autoComplete="address-level2"
          maxLength={80}
        />
        <TextInput
          name="postal_code"
          label="Postal code"
          optional
          props={p}
          autoComplete="postal-code"
          maxLength={16}
        />
      </div>
      <div className="seller-form-row">
        <TextInput
          name="phone"
          label="Phone"
          hint="With + and the country code, for example +93 for Afghanistan."
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          props={p}
          maxLength={24}
        />
        <TextInput
          name="contact_email"
          label="Contact e-mail"
          type="email"
          inputMode="email"
          autoComplete="email"
          props={p}
          maxLength={254}
        />
      </div>
    </div>
  );
}

function TaxStep(p: StepProps) {
  const afghan = p.values.country === "AF" || p.values.tax_country === "AF";
  return (
    <div className="seller-form">
      <p className="seller-hint">
        Marketplaces in the EU must report sellers' tax details to the tax authorities. Fill in what
        you have; leave the rest empty.
      </p>
      {afghan && (
        <p className="verify-note" role="note">
          Selling from Afghanistan: a tax identification number (TIN) and a VAT number are not
          required.
        </p>
      )}
      <CountryField
        name="tax_country"
        label="Tax country"
        optional
        hint="The country where you pay income tax."
        props={p}
      />
      <TextInput
        name="tin"
        label="Tax identification number (TIN)"
        optional
        hint="The number your tax office gave you."
        props={p}
        maxLength={30}
      />
      {p.values.seller_type === "business" && (
        <TextInput
          name="vat_number"
          label="VAT number"
          optional
          hint="Only if your company has one."
          props={p}
          maxLength={24}
        />
      )}
    </div>
  );
}

function ShopStep(p: StepProps & { categories: string[] }) {
  const options = [
    ...new Set([
      ...p.categories,
      "Other",
      ...(p.values.main_category ? [p.values.main_category] : []),
    ]),
  ];
  return (
    <div className="seller-form">
      <Field id="v-main_category" label="Main category" error={p.errors.main_category}>
        {(aria) => (
          <select
            {...aria}
            className="seller-select"
            value={p.values.main_category}
            disabled={p.disabled}
            onChange={(e) => p.set("main_category", e.target.value)}
          >
            <option value="">Choose a category</option>
            {options.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field
        id="v-product_summary"
        label="What do you sell?"
        hint="A few sentences: the kind of products, and whether you make them yourself."
        error={p.errors.product_summary}
      >
        {(aria) => (
          <Textarea
            {...aria}
            rows={4}
            maxLength={1000}
            value={p.values.product_summary}
            disabled={p.disabled}
            onChange={(e) => p.set("product_summary", e.target.value)}
          />
        )}
      </Field>
      <div className="seller-form-row">
        <CountryField name="ship_from_country" label="Ship from (country)" props={p} />
        <TextInput name="ship_from_city" label="Ship from (city)" props={p} maxLength={80} />
      </div>
      <Field id="v-ships_to" label="Countries you ship to" error={p.errors.ships_to}>
        {(aria) => (
          <CountryMultiSelect
            {...aria}
            value={p.values.ships_to}
            disabled={p.disabled}
            onChange={(codes) => p.set("ships_to", codes)}
          />
        )}
      </Field>
    </div>
  );
}

const DECLARATIONS = [
  {
    key: "declared_truthful",
    text: "The information I gave is true, and I will keep it up to date.",
  },
  {
    key: "declared_lawful_goods",
    text: "I will only sell lawful goods, and I have read the Prohibited items in the Seller Agreement.",
  },
  {
    key: "declared_independent",
    text: "I am an independent seller and responsible for my own taxes.",
  },
] as const;

/** Every answer, grouped by step, each group with an "Edit" link. */
export function ReviewSummary({
  values,
  documents,
  onEdit,
}: {
  values: VerificationForm;
  documents: SellerDocument[];
  onEdit?: ((step: StepId) => void) | undefined;
}) {
  const country = (c: string) => (c ? countryNameEn(c) : "—");
  const v = (s: string) => s.trim() || "—";
  const business = values.seller_type === "business";
  const groups: { step: StepId; rows: [string, ReactNode][] }[] = [
    {
      step: "type",
      rows: [["Seller type", business ? "Business" : values.seller_type ? "Individual" : "—"]],
    },
    {
      step: "identity",
      rows: business
        ? [
            ["Company name", v(values.company_name)],
            ["Registration number", v(values.company_reg_number)],
            ["Country of registration", country(values.company_country)],
            ["Representative", v(values.full_name)],
          ]
        : [
            ["Full name", v(values.full_name)],
            ["Date of birth", v(values.birth_date)],
            ["ID document", values.id_doc_type ? ID_DOC_LABEL[values.id_doc_type] : "—"],
            ["Document number", v(values.id_doc_number)],
            ["Issuing country", country(values.id_doc_country)],
          ],
    },
    {
      step: "address",
      rows: [
        ["Country", country(values.country)],
        [
          "Address",
          [values.address_line1, values.address_line2, values.postal_code, values.city]
            .filter((x) => x.trim())
            .join(", ") || "—",
        ],
        ["Phone", v(values.phone)],
        ["Contact e-mail", v(values.contact_email)],
      ],
    },
    {
      step: "tax",
      rows: [
        ["Tax country", country(values.tax_country)],
        ["TIN", v(values.tin)],
        ...(business ? ([["VAT number", v(values.vat_number)]] as [string, ReactNode][]) : []),
      ],
    },
    {
      step: "shop",
      rows: [
        ["Main category", v(values.main_category)],
        ["What you sell", v(values.product_summary)],
        [
          "Ship from",
          [
            values.ship_from_city,
            values.ship_from_country && countryNameEn(values.ship_from_country),
          ]
            .filter(Boolean)
            .join(", ") || "—",
        ],
        ["Ship to", values.ships_to.map(countryNameEn).join(", ") || "—"],
      ],
    },
    {
      step: "documents",
      rows: [
        [
          "Documents",
          documents.length
            ? documents.map((d) => `${DOCUMENT_LABEL[d.kind]}: ${d.file_name}`).join("; ")
            : "—",
        ],
      ],
    },
  ];
  return (
    <div className="grid gap-4" data-testid="verify-summary">
      {groups.map((g) => (
        <section key={g.step} className="verify-summary" aria-labelledby={`sum-${g.step}`}>
          <div className="verify-summary-head">
            <h3 id={`sum-${g.step}`}>{STEPS[stepIndex(g.step)]!.label}</h3>
            {onEdit && (
              <Button type="button" size="sm" variant="ghost" onClick={() => onEdit(g.step)}>
                Edit<span className="sr-only"> {STEPS[stepIndex(g.step)]!.label}</span>
              </Button>
            )}
          </div>
          <dl>
            {g.rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd dir="auto">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/**
 * The 7-step form. Saves through save_seller_profile only ("Save draft" on
 * every step, and on "Next"); "Submit for review" calls submit_seller_profile.
 */
export function VerificationWizard({
  userId,
  profile,
  documents,
  categories,
  now,
}: {
  userId: string;
  profile: SellerProfile | null;
  documents: SellerDocument[];
  categories: string[];
  /** For tests. */
  now?: Date;
}) {
  const qc = useQueryClient();
  const status: VerificationStatus = statusOf(profile);
  const editable = isEditable(status);
  const [values, setValues] = useState<VerificationForm>(() => profileToForm(profile));
  const kinds = documents.map((d) => d.kind);
  const [step, setStep] = useState<StepId>(() => resumeStep(profileToForm(profile), kinds, now));
  const [reachable, setReachable] = useState(() => stepIndex(step));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState<"save" | "next" | "submit" | null>(null);
  const [saved, setSaved] = useState<string>("");
  const [problem, setProblem] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
  }, [step]);

  const set: StepProps["set"] = (key, value) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setSaved("");
  };
  const go = (id: StepId) => {
    setProblem(null);
    setErrors({});
    setStep(id);
    setReachable((r) => Math.max(r, stepIndex(id)));
  };
  const missing = missingDocuments(values.seller_type, kinds);
  const done = (id: StepId) => stepComplete(id, values, kinds, now);

  const save = async (): Promise<boolean> => {
    const draftErrors = validateForm(values, "draft", now);
    if (Object.keys(draftErrors).length) {
      setErrors(draftErrors);
      setProblem("Some answers need fixing before they can be saved.");
      return false;
    }
    try {
      await sellerVerificationService.saveDraft(values);
      await qc.invalidateQueries({ queryKey: verificationKeys.profile(userId) });
      setSaved("Draft saved.");
      return true;
    } catch (e) {
      setProblem(`Your draft could not be saved: ${errorText(e)}`);
      return false;
    }
  };

  const onSave = async () => {
    setBusy("save");
    setProblem(null);
    await save();
    setBusy(null);
  };

  const onNext = async () => {
    setProblem(null);
    const current = STEPS[stepIndex(step)]!;
    const errs = stepErrors(step, validateForm(values, "complete", now));
    if (step === "documents" && missing.length) {
      setProblem(`Still needed: ${missing.map((k) => DOCUMENT_LABEL[k]).join(", ")}.`);
      return;
    }
    if (Object.keys(errs).length) {
      setErrors(errs);
      setProblem(`Please check the ${current.label.toLowerCase()} step.`);
      return;
    }
    setBusy("next");
    const ok = current.fields.length ? await save() : true;
    setBusy(null);
    if (ok) go(STEPS[stepIndex(step) + 1]!.id);
  };

  const onSubmit = async () => {
    setProblem(null);
    const all = validateForm(values, "complete", now);
    if (Object.keys(all).length || missing.length) {
      setErrors(stepErrors("review", all));
      const incomplete = STEPS.filter((s) => s.id !== "review" && !done(s.id)).map((s) => s.label);
      setProblem(
        incomplete.length
          ? `Please complete: ${incomplete.join(", ")}.`
          : "Please confirm the three statements.",
      );
      return;
    }
    setBusy("submit");
    const ok = await save();
    if (ok)
      try {
        await sellerVerificationService.submit();
        await qc.invalidateQueries({ queryKey: verificationKeys.profile(userId) });
      } catch (e) {
        // submit_seller_profile's messages are written for sellers: shown as they are.
        setProblem(errorText(e));
      }
    setBusy(null);
  };

  const props: StepProps = { values, set, errors, disabled: !editable || !!busy };
  const current = STEPS[stepIndex(step)]!;
  const isLast = step === "review";

  return (
    <section className="verify-wizard seller-card" aria-labelledby="verify-step-title">
      <Progress current={step} reachable={reachable} done={done} onGo={go} />
      <h2 id="verify-step-title" ref={heading} tabIndex={-1} className="verify-step-title">
        {current.label}
      </h2>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void (isLast ? onSubmit() : onNext());
        }}
      >
        {step === "type" && (
          <TypeCards
            value={values.seller_type}
            disabled={props.disabled}
            error={errors.seller_type}
            onChange={(t) => set("seller_type", t)}
          />
        )}
        {step === "identity" && <IdentityStep {...props} />}
        {step === "address" && <AddressStep {...props} />}
        {step === "tax" && <TaxStep {...props} />}
        {step === "shop" && <ShopStep {...props} categories={categories} />}
        {step === "documents" && (
          <DocumentsStep
            userId={userId}
            sellerType={values.seller_type}
            documents={documents}
            editable={editable}
            missing={[]}
          />
        )}
        {step === "review" && (
          <div className="grid gap-6">
            <ReviewSummary
              values={values}
              documents={documents}
              onEdit={editable ? go : undefined}
            />
            <fieldset className="grid gap-3">
              <legend className="verify-label">Declarations</legend>
              {DECLARATIONS.map((d) => (
                <div key={d.key}>
                  <label className="seller-check">
                    <input
                      type="checkbox"
                      checked={values[d.key]}
                      disabled={props.disabled}
                      required
                      aria-invalid={!!errors[d.key]}
                      aria-describedby={errors[d.key] ? `${d.key}-error` : undefined}
                      onChange={(e) => set(d.key, e.target.checked)}
                    />
                    <span>{d.text}</span>
                  </label>
                  {errors[d.key] && (
                    <p id={`${d.key}-error`} className="seller-error">
                      {errors[d.key]}
                    </p>
                  )}
                </div>
              ))}
              <p className="seller-hint">
                Read the{" "}
                <a href="/legal/seller-agreement" target="_blank" rel="noopener">
                  Seller Agreement
                </a>{" "}
                (including the{" "}
                <a href="/legal/seller-agreement#5-prohibited-items" target="_blank" rel="noopener">
                  Prohibited items
                </a>
                ), the{" "}
                <a href="/legal/terms" target="_blank" rel="noopener">
                  Terms of Use
                </a>{" "}
                and the{" "}
                <a href="/legal/privacy" target="_blank" rel="noopener">
                  Privacy Policy
                </a>
                . They open in a new tab.
              </p>
            </fieldset>
          </div>
        )}

        <div role="alert" className="verify-problem">
          {problem && <p className="seller-error">{problem}</p>}
        </div>
        <p role="status" className="seller-hint verify-saved">
          {saved}
        </p>

        {editable && (
          <div className="verify-actions">
            {stepIndex(step) > 0 && (
              <Button
                type="button"
                variant="ghost"
                disabled={!!busy}
                onClick={() => go(STEPS[stepIndex(step) - 1]!.id)}
              >
                Back
              </Button>
            )}
            <Button type="button" variant="outline" disabled={!!busy} onClick={() => void onSave()}>
              {busy === "save" ? "Saving…" : "Save draft"}
            </Button>
            <Button type="submit" disabled={!!busy}>
              {isLast
                ? busy === "submit"
                  ? "Submitting…"
                  : "Submit for review"
                : busy === "next"
                  ? "Saving…"
                  : "Next"}
            </Button>
          </div>
        )}
      </form>
    </section>
  );
}
