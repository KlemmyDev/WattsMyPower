import type { Onboarding, OnboardingChanges, StepId } from "~/features/onboarding/types";

/** The guide's steps, in order. */
export const STEPS: { id: StepId; label: string }[] = [
  { id: "inverter", label: "Inverter" },
  { id: "system", label: "Your system" },
  { id: "plan", label: "Electricity plan" },
  { id: "location", label: "Location" },
  { id: "billing", label: "Billing" },
];

export const isStep = (s: unknown): s is StepId => STEPS.some((x) => x.id === s);

/** Where to pick up: the first step not yet done or skipped, else the start. */
export function resumeAt(o: Onboarding | undefined): StepId {
  return STEPS.find((s) => !o?.steps[s.id])?.id ?? STEPS[0].id;
}

/** The progress after `changes`, as the server will have it (for updating the cache straight away). */
export function applyChanges(o: Onboarding | undefined, changes: OnboardingChanges): Onboarding {
  const steps = { ...o?.steps };
  for (const [id, mark] of Object.entries(changes.steps ?? {}) as [StepId, (typeof steps)[StepId] | null][]) {
    if (mark) steps[id] = mark;
    else delete steps[id];
  }
  const complete = changes.complete ?? o?.complete ?? false;
  const dismissed = changes.dismissed ?? o?.dismissed ?? false;
  return { complete, dismissed, show: !complete && !dismissed, steps };
}
