import type { ReactNode } from "react";
import { statusOf } from "@/services/seller-verification";
import { VerificationLoadError, VerificationPage } from "./status";
import { useVerification } from "./use-verification";

/**
 * A new seller with no store: 1. verification form, 2. create the store (once
 * the details were submitted). If the verification can't be loaded (e.g. the
 * tables don't exist yet) the real error is shown and the store can still be
 * created, as before.
 */
export function GettingStarted({
  userId,
  categoryNames,
  children,
}: {
  userId: string;
  categoryNames: string[];
  children: ReactNode;
}) {
  const { profile } = useVerification(userId);
  const neverSubmitted =
    profile.isSuccess && statusOf(profile.data) === "draft" && !profile.data?.submitted_at;
  return (
    <main className="market-container grid gap-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold">Start selling on Saloree</h1>
        <ol className="verify-onboarding" aria-label="Getting started">
          <li data-current={neverSubmitted || undefined}>1. Verify who is selling</li>
          <li data-current={!neverSubmitted || undefined}>2. Create your store</li>
          <li>3. We approve, and your store goes live</li>
        </ol>
      </div>
      {profile.isPending ? (
        <div className="seller-skeleton" aria-busy="true" aria-label="Loading">
          <div />
        </div>
      ) : profile.isError ? (
        <>
          <VerificationLoadError error={profile.error} retry={() => void profile.refetch()} />
          {children}
        </>
      ) : neverSubmitted ? (
        <VerificationPage userId={userId} categories={categoryNames} />
      ) : (
        <>
          <VerificationPage userId={userId} categories={categoryNames} />
          {children}
        </>
      )}
    </main>
  );
}
