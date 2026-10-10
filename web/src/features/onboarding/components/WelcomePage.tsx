import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ComponentType } from "react";
import { sessionQuery } from "~/features/auth/api";
import { AuthScene } from "~/features/auth/components/AuthScene";
import { BrandLockup, StandalonePage } from "~/features/common/layout/components/Standalone";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Button, ButtonLink } from "~/features/common/ui/components/Button";
import { BrandMark, Icon } from "~/features/common/ui/components/Icon";
import { useToast } from "~/features/common/ui/components/Toast";
import { onboardingQuery } from "~/features/onboarding/api";
import { BillingStep } from "~/features/onboarding/components/BillingStep";
import { Confetti } from "~/features/onboarding/components/Confetti";
import { CostStep } from "~/features/onboarding/components/CostStep";
import { EXTRAS, ExtrasStep, useConnectedExtras } from "~/features/onboarding/components/ExtrasStep";
import { HouseStep } from "~/features/onboarding/components/HouseStep";
import { InverterStep } from "~/features/onboarding/components/InverterStep";
import { LocationStep } from "~/features/onboarding/components/LocationStep";
import { PlanStep } from "~/features/onboarding/components/PlanStep";
import { Overall, StepDots, StepRail, type StepNav, type StepProps } from "~/features/onboarding/components/StepParts";
import { SystemStep } from "~/features/onboarding/components/SystemStep";
import { useMarkOnboarding } from "~/features/onboarding/hooks/useMarkOnboarding";
import type { ExtraId, GuidePage, StepId, StepMark } from "~/features/onboarding/types";
import { notStarted, resumeAt, STEPS } from "~/features/onboarding/utils";

const BODIES: Record<StepId, ComponentType<StepProps>> = {
  inverter: InverterStep,
  system: SystemStep,
  house: HouseStep,
  location: LocationStep,
  plan: PlanStep,
  billing: BillingStep,
  cost: CostStep,
  extras: ExtrasStep,
};

/**
 * The set-up guide (/welcome), shown after the account is created on a new install: connect the inverter, the
 * system details it can't report (the solar array's size), the house the Overview draws, the location, the electricity
 * plan, the billing period, what the system cost, and what else is at the place (a car, smart plugs…). It opens on a
 * welcome listing the steps, then the steps themselves beside a list of them (across the top on a phone), and ends on a
 * celebration with what was done and what was skipped, and links to connect the extras picked. Every step can be
 * skipped, and the whole thing put off. The page is in the URL, so Back in the browser goes to the previous one.
 */
export function WelcomePage({ page }: { page: GuidePage | undefined }) {
  const { data: onboarding } = useQuery(onboardingQuery);
  const { data: session } = useQuery(sessionQuery);
  const navigate = useNavigate();
  const toast = useToast();
  const mark = useMarkOnboarding();
  // Opened again from Settings after it was finished: leaving it just goes back.
  const finished = !!onboarding?.complete;
  const name = session?.username ?? "";

  const go = (to: GuidePage) => navigate({ to: "/welcome", search: { step: to } });

  const leave = () => {
    if (!finished) {
      mark.mutate({ dismissed: true });
      toast("No problem. The set-up guide is in Settings whenever you want it.");
    }
    navigate({ to: "/" });
  };

  const view = page ?? (notStarted(onboarding) ? "start" : resumeAt(onboarding));

  return (
    <StandalonePage>
      <header className="mx-auto flex max-w-[1320px] items-center justify-between gap-4 px-8 pt-6 max-sm:px-4 max-sm:pt-4">
        <BrandLockup />
        {view !== "finish" && (
          <Button variant="muted-link" onClick={leave}>
            {finished ? "Back to the dashboard" : "I'll do this later"}
          </Button>
        )}
      </header>
      <main className="mx-auto w-full max-w-[1320px] px-8 pt-10 pb-20 max-sm:px-4 max-sm:pt-6">
        {view === "start" ? (
          <Start name={name} onStart={() => go(STEPS[0].id)} />
        ) : view === "finish" ? (
          <Finish steps={onboarding?.steps ?? {}} extras={onboarding?.extras ?? []} />
        ) : (
          <Steps
            key="steps"
            current={view}
            name={name}
            finished={finished}
            onboarding={onboarding?.steps ?? {}}
            go={go}
            mark={(m) => {
              const index = STEPS.findIndex((s) => s.id === view);
              if (index === STEPS.length - 1) {
                mark.mutate({ steps: { [view]: m }, complete: true });
                go("finish");
              } else {
                mark.mutate({ steps: { [view]: m } });
                go(STEPS[index + 1].id);
              }
            }}
          />
        )}
      </main>
    </StandalonePage>
  );
}

/** The welcome: what the guide does and the way in, beside the house and the steps as tiles under it. */
function Start({ name, onStart }: { name: string; onStart: () => void }) {
  return (
    <div className="grid items-center gap-14 max-lg:gap-8 lg:min-h-[calc(100svh-200px)] lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div className="flex animate-rise flex-col items-start gap-6">
        <span className="flex items-center gap-2 rounded-full border border-line-subtle bg-surface/60 py-1.5 pr-3.5 pl-1.5 text-[13px] text-ink-muted">
          <span
            className="flex size-6 items-center justify-center rounded-full"
            style={{ background: alpha(COLOR.solar, 0.16), color: COLOR.solar }}
          >
            <Icon name="sparkles" size={14} />
          </span>
          Set-up guide · about 10 minutes
        </span>
        <h1 className="text-[52px] leading-[58px] tracking-[-1.6px] text-balance wrap-anywhere max-sm:text-[38px] max-sm:leading-[44px]">
          Welcome{name ? `, ${name}` : ""}
        </h1>
        <p className="m-0 max-w-[480px] text-[17px] leading-7 text-pretty text-ink-muted">
          Let's make this dashboard yours. A few quick steps and it'll show your system and your house, what your power
          costs, and tomorrow's solar. Skip anything you'd rather do later: it's all in Settings too.
        </p>
        <Button size="lg" className="mt-2" onClick={onStart}>
          Let's go
          <Icon name="arrowR" size={17} />
        </Button>
      </div>
      <div className="flex min-w-0 flex-col gap-3">
        <AuthScene className="animate-rise [animation-delay:80ms]" />
        <ol className="m-0 grid list-none grid-cols-4 gap-2.5 p-0 max-sm:gap-1.5">
          {STEPS.map((s, k) => (
            <li
              key={s.id}
              className="glass flex animate-rise flex-col items-center gap-2.5 rounded-[20px] border border-line-subtle px-2 pt-3.5 pb-3 text-center transition-transform duration-300 ease-out hover:-translate-y-1 max-sm:rounded-2xl max-sm:px-1 max-sm:pt-2.5"
              style={{ animationDelay: `${180 + k * 50}ms` }}
            >
              <span
                className="flex size-10 items-center justify-center rounded-[13px] max-sm:size-8 max-sm:rounded-[10px]"
                style={{ background: alpha(s.color, 0.16), color: s.color }}
              >
                <Icon name={s.icon} size={18} />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-[11px] font-medium text-ink-faint tabular-nums">Step {k + 1}</span>
                <span className="text-[13px] leading-4 font-semibold max-sm:text-[11px] max-sm:leading-3.5">
                  {s.label}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** A step beside the list of them (across the top on a phone). */
function Steps({
  current,
  name,
  finished,
  onboarding,
  go,
  mark,
}: {
  current: StepId;
  name: string;
  finished: boolean;
  onboarding: Partial<Record<StepId, StepMark>>;
  go: (to: GuidePage) => void;
  mark: (m: StepMark) => void;
}) {
  const index = STEPS.findIndex((s) => s.id === current);
  const nav: StepNav = {
    step: STEPS[index],
    position: `Step ${index + 1} of ${STEPS.length}`,
    last: index === STEPS.length - 1,
    done: () => mark("done"),
    skip: () => mark("skipped"),
    back: index > 0 ? () => go(STEPS[index - 1].id) : finished ? undefined : () => go("start"),
  };
  const Body = BODIES[current];
  const title = finished ? "Set-up guide" : `Welcome${name ? `, ${name}` : ""}`;
  return (
    <div className="grid items-start gap-10 max-lg:gap-5 lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="flex animate-rise flex-col gap-6 max-lg:hidden lg:sticky lg:top-8">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-[30px] leading-9 tracking-[-0.8px] wrap-anywhere">{title}</h1>
          <p className="m-0 text-sm leading-[22px] text-pretty text-ink-muted">
            Skip anything you'd rather do later: it's all in Settings too.
          </p>
        </div>
        <Overall steps={onboarding} />
        <StepRail current={current} steps={onboarding} onJump={go} />
      </aside>
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-col gap-4 lg:hidden">
          <h1 className="text-[28px] leading-9 tracking-[-0.6px] wrap-anywhere">{title}</h1>
          <StepDots current={current} steps={onboarding} onJump={go} />
        </div>
        {/* Keyed so each step starts fresh (e.g. after going back to it) and rises into place. */}
        <section
          key={current}
          aria-labelledby="h-step"
          className="glass flex animate-rise flex-col overflow-clip rounded-3xl border border-line-subtle shadow-[0_24px_60px_-34px_var(--color-shadow-pop)] max-sm:rounded-[22px]"
        >
          <Body nav={nav} />
        </section>
      </div>
    </div>
  );
}

/**
 * The end: confetti, the extras picked in the last step to connect next, what was set up (the skipped steps with links
 * to set them up later), and into the dashboard.
 */
function Finish({ steps, extras }: { steps: Partial<Record<StepId, StepMark>>; extras: ExtraId[] }) {
  const skipped = STEPS.filter((s) => steps[s.id] !== "done").length;
  const connected = useConnectedExtras();
  const next = EXTRAS.filter((e) => extras.includes(e.id) && !connected[e.id]);
  return (
    <div className="mx-auto flex max-w-[600px] flex-col items-center gap-8 pt-6 text-center">
      <span className="relative flex size-24 items-center justify-center">
        <Confetti />
        <span
          aria-hidden
          className="radar-ripple absolute inset-0 rounded-full"
          style={{ background: alpha(COLOR.solar, 0.22) }}
        />
        <span
          className="relative z-1 flex size-24 animate-spring-in items-center justify-center rounded-[30px] border border-fg/8 bg-linear-160 from-mark-from to-mark-to"
          style={{ boxShadow: `0 0 56px ${alpha(COLOR.solar, 0.4)}` }}
        >
          <BrandMark size={38} />
        </span>
      </span>
      <div className="flex animate-rise flex-col gap-2 [animation-delay:200ms]">
        <h1 className="text-[44px] leading-[50px] tracking-[-1.2px] max-sm:text-[34px] max-sm:leading-10">
          You're all set
        </h1>
        <p className="m-0 text-base leading-6 text-pretty text-ink-muted">
          {skipped
            ? `Your dashboard's ready. ${skipped === 1 ? "One step was" : `${skipped} steps were`} skipped: pick ${skipped === 1 ? "it" : "them"} up whenever you like.`
            : "Your dashboard has everything it needs. Enjoy the sunshine."}
        </p>
      </div>
      {next.length > 0 && (
        <section
          aria-labelledby="h-next"
          className="flex w-full animate-rise flex-col gap-3 text-left [animation-delay:250ms]"
        >
          <h2 id="h-next" className="px-1 text-[15px] font-semibold">
            Next, connect what you picked
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {next.map((e) => (
              <ButtonLink
                key={e.id}
                to={e.href}
                variant="outline"
                className="h-auto justify-start gap-3 rounded-2xl border-line-subtle px-4 py-3.5 text-left whitespace-normal"
              >
                <span
                  className="flex size-9 flex-none items-center justify-center rounded-full"
                  style={{ background: alpha(e.color, 0.16), color: e.color }}
                >
                  <Icon name={e.icon} size={17} />
                </span>
                <span className="min-w-0 flex-1 text-[15px] font-medium">{e.connect}</span>
                <Icon name="chevR" size={15} className="flex-none text-ink-faint" />
              </ButtonLink>
            ))}
          </div>
        </section>
      )}
      <ul className="glass m-0 flex w-full animate-rise list-none flex-col divide-y divide-line-subtle overflow-hidden rounded-3xl border border-line-subtle p-0 text-left [animation-delay:300ms]">
        {STEPS.map((s) => {
          const done = steps[s.id] === "done";
          return (
            <li key={s.id} className="flex items-center gap-3.5 px-5 py-3.5">
              <span
                className="flex size-9 flex-none items-center justify-center rounded-full"
                style={{ background: alpha(s.color, 0.16), color: s.color }}
              >
                <Icon name={s.icon} size={17} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{s.label}</span>
              {done ? (
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-good">
                  <Icon name="check" size={15} />
                  Done
                </span>
              ) : (
                <ButtonLink to={s.href} variant="chip" className="gap-1">
                  Set it up
                  <Icon name="chevR" size={13} />
                </ButtonLink>
              )}
            </li>
          );
        })}
      </ul>
      <ButtonLink to="/" size="lg" className="animate-rise [animation-delay:400ms]">
        Open my dashboard
        <Icon name="arrowR" size={17} />
      </ButtonLink>
    </div>
  );
}
