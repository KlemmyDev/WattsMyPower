/** The first-run set-up guide's progress (GET/PATCH /api/onboarding). */

export type StepId = "inverter" | "system" | "house" | "location" | "plan" | "billing" | "cost" | "extras";

/** What else is at the place, picked in the last step, for the finish to offer connecting. */
export type ExtraId = "ev" | "home" | "inverter" | "grid";

export type StepMark = "done" | "skipped";

/** A page of the guide: its welcome, a step, or the end. */
export type GuidePage = StepId | "start" | "finish";

export type Onboarding = {
  /** Finished, or an install that was already set up when the guide arrived. */
  complete: boolean;
  /** Put off with "I'll do this later". */
  dismissed: boolean;
  /** Send signed-in visits to the guide: neither finished nor put off. */
  show: boolean;
  steps: Partial<Record<StepId, StepMark>>;
  extras: ExtraId[];
};

export type OnboardingChanges = {
  steps?: Partial<Record<StepId, StepMark | null>>;
  extras?: ExtraId[];
  complete?: boolean;
  dismissed?: boolean;
};
