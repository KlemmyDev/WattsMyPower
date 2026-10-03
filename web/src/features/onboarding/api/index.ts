import { queryOptions } from "@tanstack/react-query";
import { apiGet, apiSend } from "~/features/common/api/utils";
import type { Onboarding, OnboardingChanges } from "~/features/onboarding/types";

/** Changed only from the guide (useMarkOnboarding updates the cache), so it's fetched once per session. */
export const onboardingQuery = queryOptions({
  queryKey: ["onboarding"],
  queryFn: ({ signal }) => apiGet<Onboarding>("onboarding", undefined, { signal }),
  staleTime: Infinity,
});

export const markOnboarding = (changes: OnboardingChanges) => apiSend<Onboarding>("PATCH", "onboarding", changes);
