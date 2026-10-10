import { COLOR, DEVICE_COLORS } from "~/features/common/theme/utils/colors";
import type { IconName } from "~/features/common/ui/components/Icon";
import type { Onboarding, OnboardingChanges, StepId } from "~/features/onboarding/types";

export type StepInfo = {
  id: StepId;
  label: string;
  /** A few words on what it's for, under its name in the guide's list. */
  blurb: string;
  icon: IconName;
  color: string;
  /** Where it's set later, for a step that was skipped. */
  href: string;
};

/** The guide's steps, in order, each with its own icon and colour (the dashboard's for the same thing). */
export const STEPS: StepInfo[] = [
  {
    id: "inverter",
    label: "Inverter",
    blurb: "Find it on your network",
    icon: "bolt",
    color: COLOR.brand,
    href: "/integrations/inverters",
  },
  {
    id: "system",
    label: "Your system",
    blurb: "Your panels and battery",
    icon: "sun",
    color: COLOR.solar,
    href: "/settings/solar-battery",
  },
  {
    id: "house",
    label: "Your house",
    blurb: "How your home is drawn",
    icon: "home",
    color: DEVICE_COLORS[2],
    href: "/settings/house",
  },
  {
    id: "location",
    label: "Location",
    blurb: "For the solar forecast",
    icon: "pin",
    color: COLOR.teal,
    href: "/settings/location",
  },
  {
    id: "plan",
    label: "Electricity plan",
    blurb: "So costs match your bill",
    icon: "dollar",
    color: COLOR.good,
    href: "/bills/rates",
  },
  {
    id: "billing",
    label: "Billing",
    blurb: "Line up bill estimates",
    icon: "calendar",
    color: COLOR.lilac,
    href: "/bills/rates",
  },
  {
    id: "cost",
    label: "Cost and payback",
    blurb: "When it pays for itself",
    icon: "tag",
    color: COLOR.export,
    href: "/settings/cost",
  },
  {
    id: "extras",
    label: "Anything else",
    blurb: "A car, smart plugs and more",
    icon: "plug",
    color: COLOR.battery,
    href: "/integrations",
  },
];

export const isStep = (s: unknown): s is StepId => STEPS.some((x) => x.id === s);

/** Where to pick up: the first step not yet done or skipped, else the start. */
export function resumeAt(o: Onboarding | undefined): StepId {
  return STEPS.find((s) => !o?.steps[s.id])?.id ?? STEPS[0].id;
}

/** Nothing done or skipped yet, and not finished: the guide opens on its welcome. */
export const notStarted = (o: Onboarding | undefined) => !o?.complete && !Object.keys(o?.steps ?? {}).length;

/** The progress after `changes`, as the server will have it (for updating the cache straight away). */
export function applyChanges(o: Onboarding | undefined, changes: OnboardingChanges): Onboarding {
  const steps = { ...o?.steps };
  for (const [id, mark] of Object.entries(changes.steps ?? {}) as [StepId, (typeof steps)[StepId] | null][]) {
    if (mark) steps[id] = mark;
    else delete steps[id];
  }
  const complete = changes.complete ?? o?.complete ?? false;
  const dismissed = changes.dismissed ?? o?.dismissed ?? false;
  const extras = changes.extras ? [...new Set(changes.extras)] : (o?.extras ?? []);
  return { complete, dismissed, show: !complete && !dismissed, steps, extras };
}
