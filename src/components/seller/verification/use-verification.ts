import { useQuery } from "@tanstack/react-query";
import { stepComplete, STEPS } from "@/lib/seller-verification";
import {
  profileToForm,
  sellerVerificationService,
  verificationKeys,
  type SellerDocument,
  type SellerProfile,
} from "@/services/seller-verification";

/** The signed-in seller's profile and documents (memory only, never stored in the browser). */
export function useVerification(userId: string) {
  const profile = useQuery({
    queryKey: verificationKeys.profile(userId),
    queryFn: sellerVerificationService.myProfile,
    retry: false,
  });
  const documents = useQuery({
    queryKey: verificationKeys.documents(userId),
    queryFn: sellerVerificationService.myDocuments,
    retry: false,
  });
  return { profile, documents };
}

/** How many of the 6 input steps are complete (for "Complete your verification"). */
export function completedSteps(profile: SellerProfile | null, documents: SellerDocument[]) {
  const values = profileToForm(profile);
  const kinds = documents.map((d) => d.kind);
  const inputSteps = STEPS.filter((s) => s.id !== "review");
  const done = inputSteps.filter((s) => stepComplete(s.id, values, kinds)).length;
  return { done, total: inputSteps.length };
}
