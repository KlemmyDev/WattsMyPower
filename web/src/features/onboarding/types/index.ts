/** The first-run set-up guide's progress (GET/PATCH /api/onboarding). */

export type StepId = "inverter" | "plan" | "location" | "billing";

export type StepMark = "done" | "skipped";

export type Onboarding = {
  /** Finished, or an install that was already set up when the guide arrived. */
  complete: boolean;
  /** Put off with "I'll do this later". */
  dismissed: boolean;
  /** Send signed-in visits to the guide: neither finished nor put off. */
  show: boolean;
  steps: Partial<Record<StepId, StepMark>>;
};

export type OnboardingChanges = {
  steps?: Partial<Record<StepId, StepMark | null>>;
  complete?: boolean;
  dismissed?: boolean;
};
