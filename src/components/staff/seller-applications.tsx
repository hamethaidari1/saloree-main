import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { countryNameEn } from "@/lib/iso-countries";
import {
  DOCUMENT_LABEL,
  formatBytes,
  ID_DOC_LABEL,
  maskValue,
  STATUS_LABEL,
  type VerificationStatus,
} from "@/lib/seller-verification";
import {
  applicantName,
  errorText,
  filterApplications,
  openDocument,
  sellerVerificationService,
  verificationKeys,
  type ApplicationFilter as Filter,
  type ReviewDecision,
  type SellerProfile,
} from "@/services/seller-verification";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");
const country = (c: string | null) => (c ? countryNameEn(c) : "—");

const STATUS_VARIANT: Record<
  VerificationStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  draft: "outline",
  submitted: "default",
  needs_changes: "secondary",
  approved: "secondary",
  rejected: "destructive",
};

export function StatusBadge({ status }: { status: VerificationStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]} data-status={status}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

const DECISION: Record<
  ReviewDecision,
  { title: string; label: string; noteRequired: boolean; done: string; destructive?: boolean }
> = {
  approved: { title: "Approve", label: "Approve", noteRequired: false, done: "approved" },
  needs_changes: {
    title: "Request changes from",
    label: "Request changes",
    noteRequired: true,
    done: "asked for changes",
  },
  rejected: {
    title: "Reject",
    label: "Reject",
    noteRequired: true,
    done: "rejected",
    destructive: true,
  },
};

function ReviewDialog({
  profile,
  decision,
  onClose,
}: {
  profile: SellerProfile;
  decision: ReviewDecision | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const review = useMutation({
    mutationFn: (v: { decision: ReviewDecision; note: string }) =>
      sellerVerificationService.review(profile.user_id, v.decision, v.note),
    onSuccess: async (_d, v) => {
      // The toast names the decision only, never the seller's details.
      toast.success(`Application ${DECISION[v.decision].done}`);
      await qc.invalidateQueries({ queryKey: ["admin"] });
      setNote("");
      onClose();
    },
    onError: (e) => setError(errorText(e)),
  });
  const d = decision ? DECISION[decision] : null;
  const close = () => {
    if (review.isPending) return;
    setError(null);
    setNote("");
    onClose();
  };
  return (
    <Dialog open={!!decision} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        {d && decision && (
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              if (d.noteRequired && note.trim().length < 3)
                return setError("Write a note of at least 3 characters for the seller.");
              review.mutate({ decision, note });
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {d.title} {applicantName(profile)}?
              </DialogTitle>
              <DialogDescription>
                {decision === "approved"
                  ? "Their stores can then be published."
                  : "The seller sees your note and can change their details and submit again."}
              </DialogDescription>
            </DialogHeader>
            <div className="seller-field my-4">
              <label htmlFor="review-note" className="verify-label">
                Note to the seller{d.noteRequired ? "" : " (optional)"}
              </label>
              <Textarea
                id="review-note"
                rows={4}
                maxLength={2000}
                value={note}
                required={d.noteRequired}
                aria-invalid={!!error}
                aria-describedby={error ? "review-error" : undefined}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div role="alert" id="review-error">
              {error && <p className="seller-error">{error}</p>}
            </div>
            <DialogFooter className="mt-4">
              <Button type="button" variant="ghost" disabled={review.isPending} onClick={close}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={d.destructive ? "destructive" : "default"}
                disabled={review.isPending}
              >
                {review.isPending ? "Saving…" : d.label}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Facts({ rows }: { rows: [string, string | null | undefined][] }) {
  return (
    <dl className="staff-facts">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt>{label}</dt>
          <dd dir="auto">{value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Every field in full (staff only), documents, history and the review actions. */
export function ApplicationDrawer({
  profile,
  canReview,
  onClose,
}: {
  profile: SellerProfile | null;
  canReview: boolean;
  onClose: () => void;
}) {
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: verificationKeys.staffDetail(profile?.user_id ?? ""),
    queryFn: () => sellerVerificationService.applicationDetail(profile!),
    enabled: !!profile,
    retry: false,
  });
  const p = profile;
  const business = p?.seller_type === "business";
  return (
    <Sheet open={!!p} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="staff-drawer overflow-y-auto">
        {p && (
          <>
            <SheetHeader>
              <SheetTitle>{applicantName(p)}</SheetTitle>
              <SheetDescription>
                <StatusBadge status={p.status} />{" "}
                {p.seller_type === "business" ? "Business" : p.seller_type ? "Individual" : ""}
              </SheetDescription>
            </SheetHeader>

            {canReview && p.status !== "draft" && (
              <div className="verify-review-actions">
                <Button size="sm" onClick={() => setDecision("approved")}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDecision("needs_changes")}>
                  Request changes
                </Button>
                <Button size="sm" variant="destructive" onClick={() => setDecision("rejected")}>
                  Reject
                </Button>
              </div>
            )}

            <h3 className="staff-subhead">Identity</h3>
            <Facts
              rows={
                business
                  ? [
                      ["Company name", p.company_name],
                      ["Registration number", p.company_reg_number],
                      ["Country of registration", country(p.company_country)],
                      ["Representative", p.full_name],
                    ]
                  : [
                      ["Full name", p.full_name],
                      ["Date of birth", p.birth_date],
                      ["ID document", p.id_doc_type ? ID_DOC_LABEL[p.id_doc_type] : null],
                      ["Document number", p.id_doc_number],
                      ["Issuing country", country(p.id_doc_country)],
                    ]
              }
            />
            <h3 className="staff-subhead">Address and contact</h3>
            <Facts
              rows={[
                ["Country", country(p.country)],
                ["Street", p.address_line1],
                ["Line 2", p.address_line2],
                ["City", p.city],
                ["Postal code", p.postal_code],
                ["Phone", p.phone],
                ["E-mail", p.contact_email],
              ]}
            />
            <h3 className="staff-subhead">Tax</h3>
            <Facts
              rows={[
                ["Tax country", country(p.tax_country)],
                ["TIN", p.tin],
                ["VAT number", p.vat_number],
              ]}
            />
            <h3 className="staff-subhead">Shop</h3>
            <Facts
              rows={[
                ["Main category", p.main_category],
                ["What they sell", p.product_summary],
                [
                  "Ship from",
                  [p.ship_from_city, p.ship_from_country && countryNameEn(p.ship_from_country)]
                    .filter(Boolean)
                    .join(", "),
                ],
                ["Ship to", p.ships_to.map(countryNameEn).join(", ")],
              ]}
            />
            <h3 className="staff-subhead">Declarations</h3>
            <Facts
              rows={[
                ["Information is true", when(p.declared_truthful_at)],
                ["Lawful goods only", when(p.declared_lawful_goods_at)],
                ["Independent seller", when(p.declared_independent_at)],
              ]}
            />

            <h3 className="staff-subhead">Documents</h3>
            {detail.isPending ? (
              <div className="seller-skeleton" aria-busy="true" aria-label="Loading documents">
                <div />
              </div>
            ) : detail.isError ? (
              <p role="alert" className="seller-error">
                {errorText(detail.error)}
              </p>
            ) : !detail.data.documents.length ? (
              <p className="seller-hint">No documents uploaded.</p>
            ) : (
              <ul className="verify-files">
                {detail.data.documents.map((d) => (
                  <li key={d.id}>
                    <span>
                      <strong>{DOCUMENT_LABEL[d.kind]}</strong>{" "}
                      <span className="verify-file-name" dir="ltr">
                        {d.file_name}
                      </span>{" "}
                      <span className="seller-hint">{formatBytes(d.size_bytes)}</span>
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setDocError(null);
                        void openDocument(d.path, setDocError);
                      }}
                    >
                      Open<span className="sr-only"> {DOCUMENT_LABEL[d.kind]}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {docError && (
              <p role="alert" className="seller-error">
                {docError}
              </p>
            )}
            <p className="seller-hint">
              Each link is created when you click and works for 60 seconds.
            </p>

            <h3 className="staff-subhead">History</h3>
            <Facts
              rows={[
                ["Created", when(p.created_at)],
                ["Submitted", when(p.submitted_at)],
                ["Reviewed", when(p.reviewed_at)],
                ["Reviewed by", detail.data?.reviewer ?? (p.reviewed_by ? "A staff member" : null)],
                ["Note to the seller", p.review_note],
              ]}
            />
            <ReviewDialog profile={p} decision={decision} onClose={() => setDecision(null)} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Seller applications (admin and content_admin review; finance_admin reads).
 * The database refuses a reviewer's own profile unless they're an admin.
 */
export function SellerApplicationsPanel({ canReview }: { canReview: boolean }) {
  const list = useQuery({
    queryKey: verificationKeys.staffList,
    queryFn: sellerVerificationService.listApplications,
    retry: false,
  });
  const [filter, setFilter] = useState<Filter>("submitted");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const all = list.data ?? [];
  const count = (f: Filter) =>
    f === "all" ? all.length : all.filter((p) => p.status === f).length;
  const shown = filterApplications(all, filter, search);
  const open = all.find((p) => p.user_id === openId) ?? null;

  return (
    <section aria-labelledby="applications-heading">
      <div className="seller-panel-head">
        <div>
          <h2 id="applications-heading">Seller applications</h2>
          <p>
            {canReview
              ? "Check who is selling before their stores go live."
              : "Read-only: who has applied to sell, and where their review stands."}
          </p>
        </div>
        <Input
          type="search"
          className="admin-search"
          placeholder="Search name, e-mail or company"
          aria-label="Search applications"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div role="radiogroup" aria-label="Filter by status" className="seller-segmented mb-4">
        {(["submitted", "needs_changes", "approved", "rejected", "draft", "all"] as Filter[]).map(
          (f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={filter === f}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All" : STATUS_LABEL[f]}{" "}
              <span className="verify-count" aria-label={`${count(f)} applications`}>
                {count(f)}
              </span>
            </button>
          ),
        )}
      </div>

      {list.isPending ? (
        <div className="seller-skeleton" aria-busy="true" aria-label="Loading">
          <div />
          <div />
        </div>
      ) : list.isError ? (
        <div role="alert" className="seller-empty">
          <h3>Seller applications could not be loaded.</h3>
          <p>{errorText(list.error)}</p>
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            Try again
          </Button>
        </div>
      ) : !shown.length ? (
        <p className="seller-hint">No applications match these filters.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="seller-order-table" data-testid="applications-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Type</th>
                <th scope="col">Country</th>
                <th scope="col">ID / registration</th>
                <th scope="col">Submitted</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.user_id}>
                  <th scope="row">
                    <button
                      type="button"
                      className="staff-link"
                      onClick={() => setOpenId(p.user_id)}
                    >
                      {applicantName(p)}
                    </button>
                    {p.contact_email && (
                      <bdi className="block text-xs text-muted-foreground">{p.contact_email}</bdi>
                    )}
                  </th>
                  <td>
                    {p.seller_type === "business" ? "Business" : p.seller_type ? "Individual" : "—"}
                  </td>
                  <td>{country(p.country)}</td>
                  <td className="tabular-nums" dir="ltr">
                    {maskValue(
                      p.seller_type === "business" ? p.company_reg_number : p.id_doc_number,
                    )}
                    {p.tin && <span className="block text-xs">TIN {maskValue(p.tin)}</span>}
                  </td>
                  <td>{p.submitted_at ? new Date(p.submitted_at).toLocaleDateString() : "—"}</td>
                  <td>
                    <StatusBadge status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ApplicationDrawer profile={open} canReview={canReview} onClose={() => setOpenId(null)} />
    </section>
  );
}
