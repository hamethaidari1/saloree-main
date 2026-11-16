import type { ReactNode } from "react";
import type { StoreRow } from "@/data/db";
import { agreementAccepted } from "@/lib/active-store";
import { legalDocument } from "@/services/legal";
import { storeError } from "@/services/seller";
import { statusOf } from "@/services/seller-verification";
import { canCreateStore, limitErrorText } from "@/services/store-limits";
import { useStoreLimit } from "./use-create-store";
import { StoreForm } from "./store-form";
import {
  VerificationLoadError,
  VerificationPage,
  VerificationStatusCard,
} from "./verification/status";
import { useVerification } from "./verification/use-verification";

/** "Create your store" (first) or "Create another store": the same form and checks. */
export function CreateStoreForm({
  stores,
  categoryNames,
  busy,
  error,
  onSubmit,
}: {
  stores: StoreRow[];
  categoryNames: string[];
  busy: boolean;
  error: unknown;
  onSubmit: Parameters<typeof StoreForm>[0]["onSubmit"];
}) {
  const agreement = legalDocument("seller-agreement");
  // Asked again only when the agreement changed since it was last accepted.
  const already = agreementAccepted(stores, agreement?.updated);
  return (
    <>
      {already && agreement && (
        <p className="seller-hint mb-4" data-testid="agreement-carried">
          You already accepted the current Seller Agreement (version of {agreement.updated}). It
          also applies to this store.
        </p>
      )}
      <StoreForm
        categoryNames={categoryNames}
        submitLabel="Create store"
        agreement={already ? null : agreement}
        busy={busy}
        onSubmit={onSubmit}
      />
      {error ? (
        <p role="alert" className="seller-error mt-3" data-testid="create-store-error">
          {storeError(error)}
        </p>
      ) : null}
    </>
  );
}

/**
 * Before the form: the PERSON's verification (once for all stores). Approved
 * people go straight to the form; people who never submitted see the
 * verification form first; others see where their review stands, and the form.
 */
export function CreateStoreGate({
  userId,
  categoryNames,
  children,
}: {
  userId: string;
  categoryNames: string[];
  children: ReactNode;
}) {
  const { profile, documents } = useVerification(userId);
  if (profile.isPending)
    return (
      <div className="seller-skeleton" aria-busy="true" aria-label="Loading">
        <div />
      </div>
    );
  // If the verification can't be loaded, the real error shows and the form still works.
  if (profile.isError)
    return (
      <>
        <VerificationLoadError error={profile.error} retry={() => void profile.refetch()} />
        {children}
      </>
    );
  const status = statusOf(profile.data);
  if (status === "approved") return <>{children}</>;
  if (status === "draft" && !profile.data?.submitted_at)
    return <VerificationPage userId={userId} categories={categoryNames} />;
  return (
    <>
      <VerificationStatusCard profile={profile.data} documents={documents.data ?? []} />
      {children}
    </>
  );
}

/** "Stores: 1 of 3", and why another one can't be created. */
export function StoreLimitLine({ userId }: { userId: string }) {
  const limit = useStoreLimit(userId);
  if (limit.isPending) return null;
  if (limit.isError)
    return (
      <p className="seller-error text-xs" role="alert">
        Store limit could not be loaded: {limitErrorText(limit.error)}
      </p>
    );
  return (
    <p className="seller-hint text-xs" data-testid="store-limit-line">
      Stores: {limit.data.used} of {limit.data.max_stores}
      {!canCreateStore(limit.data) && " · limit reached"}
    </p>
  );
}
