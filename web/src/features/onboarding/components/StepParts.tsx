import type { ReactNode } from "react";
import { Button } from "~/features/common/ui/components/Button";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import type { Onboarding, StepId } from "~/features/onboarding/types";
import { STEPS } from "~/features/onboarding/utils";

/** What a step can do: move on (marking it done or skipped), or go back. */
export type StepNav = {
  /** "Step 2 of 4". */
  position: string;
  last: boolean;
  done: () => void;
  skip: () => void;
  back?: () => void;
};

export type StepProps = { nav: StepNav };

/** A step's heading and a line or two about why it matters. */
export function StepIntro({ nav, title, children }: { nav: StepNav; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 p-6 pb-5">
      <span className="text-xs font-semibold tracking-[0.4px] text-ink-faint uppercase">{nav.position}</span>
      <h2 id="h-step" className="font-sans text-[28px] leading-9 font-normal tracking-[-0.5px] max-sm:text-2xl">
        {title}
      </h2>
      <p className="m-0 text-[15px] leading-6 text-pretty text-ink-muted">{children}</p>
    </div>
  );
}

/** A step's form, padded to line up with its heading. */
export function StepBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex flex-col gap-6 px-6 pb-6", className)}>{children}</div>;
}

/**
 * Back, skip, and the step's main button (Continue, or Finish on the last step). On phones they stack,
 * with the main button on top.
 */
export function StepFooter({
  nav,
  label,
  disabled,
  onClick = nav.done,
}: {
  nav: StepNav;
  label?: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-line-subtle px-6 py-5 max-sm:flex-col-reverse max-sm:items-stretch">
      {nav.back && (
        <Button variant="outline" className="max-sm:justify-center" onClick={nav.back}>
          Back
        </Button>
      )}
      <Button
        variant="muted-link"
        className="mr-2 ml-auto max-sm:mx-0 max-sm:justify-center max-sm:py-2"
        onClick={nav.skip}
      >
        {nav.last ? "Skip and finish" : "Skip for now"}
      </Button>
      <Button className="max-sm:justify-center" disabled={disabled} onClick={onClick}>
        {label ?? (nav.last ? "Finish" : "Continue")}
      </Button>
    </div>
  );
}

/** The steps as numbered dots: done ones ticked, skipped ones left open. Any of them can be jumped to. */
export function Progress({
  current,
  steps,
  onJump,
}: {
  current: StepId;
  steps: Onboarding["steps"];
  onJump: (step: StepId) => void;
}) {
  return (
    <ol className="m-0 flex list-none items-center gap-2 p-0" aria-label="Set-up steps">
      {STEPS.map((s, k) => {
        const on = s.id === current;
        const done = steps[s.id] === "done";
        const state = on ? "current step" : done ? "done" : steps[s.id] === "skipped" ? "skipped" : "not started";
        return (
          <li key={s.id} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none">
            <button
              type="button"
              aria-current={on ? "step" : undefined}
              aria-label={`${s.label}, ${state}`}
              onClick={() => onJump(s.id)}
              className="flex min-w-0 items-center gap-2 rounded-full border-0 bg-transparent p-0 text-left"
            >
              <span
                className={cn(
                  "flex size-7 flex-none items-center justify-center rounded-full border text-[13px] font-semibold tabular-nums",
                  on
                    ? "border-ink bg-ink text-ink-inverse"
                    : done
                      ? "border-transparent bg-good-subtle text-good"
                      : "border-line bg-surface text-ink-faint",
                )}
              >
                {done && !on ? <Icon name="check" size={15} /> : k + 1}
              </span>
              <span
                className={cn(
                  "truncate text-[13px] max-md:hidden",
                  on ? "font-semibold text-ink" : "font-medium text-ink-muted",
                )}
              >
                {s.label}
              </span>
            </button>
            {k < STEPS.length - 1 && <span aria-hidden className="h-px min-w-3 flex-1 bg-line" />}
          </li>
        );
      })}
    </ol>
  );
}
