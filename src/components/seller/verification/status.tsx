import { Link } from "@tanstack/react-router";
import { CircleAlert, CircleCheck, Clock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isEditable, STATUS_LABEL, type VerificationStatus } from "@/lib/seller-verification";
import {
  errorText,
  profileToForm,
  statusOf,
  type SellerDocument,
  type SellerProfile,
} from "@/services/seller-verification";
import { completedSteps, useVerification } from "./use-verification";
import { ReviewSummary, VerificationWizard } from "./wizard";

/** The real database error, as it is (e.g. while the tables don't exist yet). */
export function VerificationLoadError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div role="alert" className="seller-empty">
      <h3>Your verification could not be loaded.</h3>
      <p>{errorText(error)}</p>
      <Button variant="outline" size="sm" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}

/** One card per status. */
export function VerificationStatusCard({
  profile,
  documents,
}: {
  profile: SellerProfile | null;
  documents: SellerDocument[];
}) {
  const status = statusOf(profile);
  if (status === "approved")
    return (
      <div className="verify-status" data-status="approved" data-testid="verify-status">
        <CircleCheck aria-hidden />
        <div>
          <h2>You're verified</h2>
          <p>Your seller details were approved. Your stores can now be published.</p>
        </div>
      </div>
    );
  if (status === "submitted")
    return (
      <div className="verify-status" data-status="submitted" data-testid="verify-status">
        <Clock aria-hidden />
        <div>
          <h2>We are reviewing your details</h2>
          <p>This usually takes 1-3 working days. You can't change your answers meanwhile.</p>
          {profile?.submitted_at && (
            <p className="seller-hint">
              Submitted {new Date(profile.submitted_at).toLocaleString()}.
            </p>
          )}
        </div>
      </div>
    );
  if (status === "needs_changes" || status === "rejected")
    return (
      <div className="verify-status" data-status={status} data-testid="verify-status" role="note">
        <CircleAlert aria-hidden />
        <div>
          <h2>
            {status === "needs_changes"
              ? "Please update your details"
              : "Your verification was not approved"}
          </h2>
          {profile?.review_note && (
            <blockquote className="verify-review-note">
              <p className="verify-review-note-label">Note from the Saloree team</p>
              <p dir="auto">{profile.review_note}</p>
            </blockquote>
          )}
          <p>Change what is needed below, then submit again.</p>
        </div>
      </div>
    );
  const { done, total } = completedSteps(profile, documents);
  return (
    <div className="verify-status" data-status="draft" data-testid="verify-status">
      <ShieldCheck aria-hidden />
      <div>
        <h2>Complete your verification</h2>
        <p>
          Before your store can go live, we need to know who is selling. You can prepare your store
          while we check your details.
        </p>
        <p className="seller-hint">
          {done} of {total} steps done
        </p>
        <progress
          className="verify-meter"
          max={total}
          value={done}
          aria-label="Verification progress"
        >
          {done} of {total}
        </progress>
      </div>
    </div>
  );
}

/** Status card, then the form (editable) or the answers (read-only). */
export function VerificationPage({ userId, categories }: { userId: string; categories: string[] }) {
  const { profile, documents } = useVerification(userId);
  if (profile.isPending || documents.isPending)
    return (
      <div className="seller-skeleton" aria-busy="true" aria-label="Loading">
        <div />
      </div>
    );
  if (profile.isError || documents.isError)
    return (
      <VerificationLoadError
        error={profile.error ?? documents.error}
        retry={() => {
          void profile.refetch();
          void documents.refetch();
        }}
      />
    );
  const status = statusOf(profile.data);
  return (
    <div className="grid gap-6">
      <VerificationStatusCard profile={profile.data} documents={documents.data} />
      {isEditable(status) ? (
        <VerificationWizard
          userId={userId}
          profile={profile.data}
          documents={documents.data}
          categories={categories}
        />
      ) : (
        <section className="seller-card" aria-labelledby="verify-answers">
          <h2 id="verify-answers" className="mb-4 text-lg font-semibold">
            Your answers
          </h2>
          <ReviewSummary values={profileToForm(profile.data)} documents={documents.data} />
        </section>
      )}
    </div>
  );
}

const BANNER: Record<Exclude<VerificationStatus, "approved">, string> = {
  draft: "Complete your verification so your store can be published.",
  submitted: "We are reviewing your details. This usually takes 1-3 working days.",
  needs_changes: "The Saloree team asked you to update your verification details.",
  rejected: "Your verification was not approved. See the note and submit again.",
};

/** On every seller page until approved. */
export function VerificationBanner({ userId }: { userId: string }) {
  const { profile } = useVerification(userId);
  if (profile.isPending) return null;
  if (profile.isError)
    return (
      <div className="verify-banner" data-status="error" role="alert">
        <p>Verification status could not be loaded: {errorText(profile.error)}</p>
      </div>
    );
  const status = statusOf(profile.data);
  if (status === "approved") return null;
  return (
    <div className="verify-banner" data-status={status} data-testid="verify-banner">
      <p>
        <strong>{STATUS_LABEL[status]}:</strong> {BANNER[status]}
      </p>
      <Link to="/seller/verification" className="seller-cta-link">
        {status === "submitted" ? "View details" : "Go to verification"}
      </Link>
    </div>
  );
}

/** Payouts: a notice until approved (payout rules unchanged). */
export function PayoutVerificationNotice({ userId }: { userId: string }) {
  const { profile } = useVerification(userId);
  if (profile.isPending || profile.isError || statusOf(profile.data) === "approved") return null;
  return (
    <p className="verify-note" role="note" data-testid="payout-verification-notice">
      Payouts start after your seller details are verified.{" "}
      <Link to="/seller/verification">Check your verification</Link>.
    </p>
  );
}
