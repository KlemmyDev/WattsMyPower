import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ComponentType } from "react";
import { sessionQuery } from "~/features/auth/api";
import { Button } from "~/features/common/ui/components/Button";
import { BrandMark } from "~/features/common/ui/components/Icon";
import { useToast } from "~/features/common/ui/components/Toast";
import { onboardingQuery } from "~/features/onboarding/api";
import { BillingStep } from "~/features/onboarding/components/BillingStep";
import { InverterStep } from "~/features/onboarding/components/InverterStep";
import { LocationStep } from "~/features/onboarding/components/LocationStep";
import { PlanStep } from "~/features/onboarding/components/PlanStep";
import { SystemStep } from "~/features/onboarding/components/SystemStep";
import { Progress, type StepNav, type StepProps } from "~/features/onboarding/components/StepParts";
import { useMarkOnboarding } from "~/features/onboarding/hooks/useMarkOnboarding";
import type { StepId, StepMark } from "~/features/onboarding/types";
import { resumeAt, STEPS } from "~/features/onboarding/utils";

const BODIES: Record<StepId, ComponentType<StepProps>> = {
  inverter: InverterStep,
  system: SystemStep,
  plan: PlanStep,
  location: LocationStep,
  billing: BillingStep,
};

/**
 * The set-up guide (/welcome), shown after the account is created on a new install: connect the
 * inverter, the system details it can't report (the solar array's size), the electricity plan, the location and the billing period. Every step can be skipped, and
 * the whole thing put off; Finish opens the Overview. The step is in the URL, so Back in the browser
 * goes to the previous one.
 */
export function WelcomePage({ step }: { step: StepId | undefined }) {
  const { data: onboarding } = useQuery(onboardingQuery);
  const { data: session } = useQuery(sessionQuery);
  const navigate = useNavigate();
  const toast = useToast();
  const mark = useMarkOnboarding();
  const current = step ?? resumeAt(onboarding);
  const index = STEPS.findIndex((s) => s.id === current);
  const last = index === STEPS.length - 1;
  // Opened again from System after it was finished: leaving it just goes back.
  const finished = !!onboarding?.complete;

  const go = (to: StepId) => navigate({ to: "/welcome", search: { step: to } });

  const leave = () => {
    if (!finished) {
      mark.mutate({ dismissed: true });
      toast("No problem. The set-up guide is in Settings whenever you want it.");
    }
    navigate({ to: "/" });
  };

  const next = (m: StepMark) => {
    if (last) {
      mark.mutate({ steps: { [current]: m }, complete: true });
      toast("You're all set.");
      navigate({ to: "/" });
    } else {
      mark.mutate({ steps: { [current]: m } });
      go(STEPS[index + 1].id);
    }
  };

  const nav: StepNav = {
    position: `Step ${index + 1} of ${STEPS.length}`,
    last,
    done: () => next("done"),
    skip: () => next("skipped"),
    back: index > 0 ? () => go(STEPS[index - 1].id) : undefined,
  };
  const Body = BODIES[current];

  return (
    <div className="min-h-screen bg-canvas">
      <header className="mx-auto flex max-w-[800px] items-center justify-between gap-4 px-8 pt-6 max-sm:px-4 max-sm:pt-4">
        <span className="flex items-center gap-3">
          <span className="flex size-10 flex-none items-center justify-center rounded-[13px] border border-fg/8 bg-linear-160 from-mark-from to-mark-to">
            <BrandMark />
          </span>
          <span className="font-display text-lg font-semibold tracking-[-0.4px] whitespace-nowrap max-2xs:hidden">
            Watts<span className="text-solar">My</span>Power
          </span>
        </span>
        <Button variant="muted-link" onClick={leave}>
          {finished ? "Back to the dashboard" : "I'll do this later"}
        </Button>
      </header>
      <main className="mx-auto flex w-full max-w-[800px] flex-col gap-6 px-8 pt-10 pb-20 max-sm:px-4 max-sm:pt-7">
        <div className="flex flex-col gap-2">
          <h1 className="text-[32px] leading-10 tracking-[-0.8px] wrap-anywhere max-sm:text-[28px] max-sm:leading-9">
            {finished ? "Set-up guide" : `Welcome${session?.username ? `, ${session.username}` : ""}`}
          </h1>
          <p className="m-0 text-[15px] leading-6 text-pretty text-ink-muted">
            Five quick steps to get your dashboard showing your system, your costs and your forecast. Skip anything
            you'd rather do later: it's all under Manage too.
          </p>
        </div>
        <Progress current={current} steps={onboarding?.steps ?? {}} onJump={go} />
        <section
          aria-labelledby="h-step"
          className="flex flex-col overflow-hidden rounded-3xl border border-line-subtle bg-surface"
        >
          {/* Keyed so each step starts fresh, e.g. after going back to it. */}
          <Body key={current} nav={nav} />
        </section>
      </main>
    </div>
  );
}
