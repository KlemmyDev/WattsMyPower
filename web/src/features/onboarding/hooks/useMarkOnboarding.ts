import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "~/features/common/api/utils";
import { useToast } from "~/features/common/ui/components/Toast";
import { markOnboarding, onboardingQuery } from "~/features/onboarding/api";
import type { OnboardingChanges } from "~/features/onboarding/types";
import { applyChanges } from "~/features/onboarding/utils";

/**
 * Mark the guide's progress. The cache changes straight away, so finishing or putting it off opens the
 * dashboard at once. It's left as it is when the server answers (an earlier, slower answer mustn't undo a
 * later change), and if saving fails: the guide then comes back on the next visit, rather than now.
 */
export function useMarkOnboarding() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: markOnboarding,
    onMutate: (changes: OnboardingChanges) => {
      qc.setQueryData(onboardingQuery.queryKey, (o) => applyChanges(o, changes));
    },
    onError: (err) => toast(errorMessage(err, "Your progress couldn't be saved.")),
  });
}
