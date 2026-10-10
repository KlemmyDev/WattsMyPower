import type { ReactNode } from "react";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import type { Onboarding, StepId } from "~/features/onboarding/types";
import { STEPS, type StepInfo } from "~/features/onboarding/utils";

/** What a step can do: move on (marking it done or skipped), or go back. */
export type StepNav = {
  step: StepInfo;
  /** "Step 2 of 5". */
  position: string;
  last: boolean;
  done: () => void;
  skip: () => void;
  back?: () => void;
};

export type StepProps = { nav: StepNav };

/** A step's icon in a tile of its colour. */
function StepTile({ step, className }: { step: StepInfo; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("flex size-12 flex-none items-center justify-center rounded-2xl", className)}
      style={{ background: alpha(step.color, 0.16), color: step.color }}
    >
      <Icon name={step.icon} size={22} />
    </span>
  );
}

/** A step's heading, its icon beside it, and a line or two about why it matters. */
export function StepIntro({ nav, title, children }: { nav: StepNav; title: string; children: ReactNode }) {
  return (
    <div
      className="flex items-start gap-5 p-7 pb-6 max-sm:gap-3.5 max-sm:p-5"
      style={{ backgroundImage: `linear-gradient(110deg, ${alpha(nav.step.color, 0.1)}, transparent 55%)` }}
    >
      <StepTile step={nav.step} className="animate-spring-in max-sm:size-10 max-sm:rounded-xl" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-[13px] font-medium" style={{ color: nav.step.color }}>
          {nav.position}
        </span>
        <h2 id="h-step" className="text-[28px] leading-9 tracking-[-0.6px] max-sm:text-2xl">
          {title}
        </h2>
        <p className="m-0 max-w-[620px] text-[15px] leading-6 text-pretty text-ink-muted">{children}</p>
      </div>
    </div>
  );
}

/** A step's form, padded to line up with its heading. */
export function StepBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex flex-col gap-6 px-7 pb-7 max-sm:px-5 max-sm:pb-5", className)}>{children}</div>;
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
    <div className="mt-auto flex items-center gap-3 border-t border-line-subtle px-7 py-5 max-sm:flex-col-reverse max-sm:items-stretch max-sm:px-5">
      {nav.back && (
        <Button variant="outline" className="max-sm:justify-center" onClick={nav.back}>
          <Icon name="chevL" size={16} className="-ml-1" />
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
        <Icon name={nav.last && !label ? "sparkles" : "arrowR"} size={16} />
      </Button>
    </div>
  );
}

type Marks = Onboarding["steps"];

const stateOf = (s: StepInfo, current: StepId | null, steps: Marks) =>
  s.id === current ? "current" : (steps[s.id] ?? "todo");

/** How far through: "2 of 5 done" and a bar filling in the brand's colours. */
export function Overall({ steps, className }: { steps: Marks; className?: string }) {
  const done = STEPS.filter((s) => steps[s.id] === "done").length;
  const seen = STEPS.filter((s) => steps[s.id]).length;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3 text-[13px]">
        <span className="font-semibold text-ink">
          {done} of {STEPS.length} done
        </span>
        <span className="text-ink-faint">{Math.round((seen / STEPS.length) * 100)}% through</span>
      </div>
      <span className="h-1.5 overflow-hidden rounded-full bg-track">
        <span
          className="block h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${(seen / STEPS.length) * 100}%`,
            background: `linear-gradient(90deg, ${COLOR.solarDeep}, ${COLOR.solar})`,
          }}
        />
      </span>
    </div>
  );
}

/**
 * The steps down the side on a wide screen: each its icon in its colour, its name and what it's for (or that it's
 * done or skipped), joined by a line that takes each finished step's colour. The current one is lifted out on a
 * panel. Any of them can be jumped to.
 */
export function StepRail({
  current,
  steps,
  onJump,
}: {
  current: StepId | null;
  steps: Marks;
  onJump: (step: StepId) => void;
}) {
  return (
    <ol className="m-0 flex list-none flex-col p-0" aria-label="Set-up steps">
      {STEPS.map((s, k) => {
        const state = stateOf(s, current, steps);
        const on = state === "current";
        const done = steps[s.id] === "done";
        const sub = on ? s.blurb : done ? "Done" : state === "skipped" ? "Skipped for now" : s.blurb;
        return (
          <li key={s.id} className="flex flex-col">
            <button
              type="button"
              aria-current={on ? "step" : undefined}
              aria-label={`${s.label}, ${on ? "current step" : done ? "done" : state === "skipped" ? "skipped" : "not started"}`}
              onClick={() => onJump(s.id)}
              className={cn(
                "flex w-full items-center gap-3.5 rounded-2xl border p-2.5 text-left transition-[background-color,border-color] duration-200",
                on ? "glass border-line-subtle" : "border-transparent hover:bg-fg/4",
              )}
            >
              <span
                className={cn(
                  "flex size-10 flex-none items-center justify-center rounded-full border transition-[background-color,box-shadow,color] duration-300",
                  on || done ? "border-transparent" : "border-line bg-surface text-ink-faint",
                )}
                style={
                  on
                    ? {
                        background: s.color,
                        color: "var(--color-canvas)",
                        boxShadow: `0 0 0 4px ${alpha(s.color, 0.2)}`,
                      }
                    : done
                      ? { background: alpha(s.color, 0.16), color: s.color }
                      : undefined
                }
              >
                {done && !on ? (
                  <Icon key="done" name="check" size={18} className="animate-spring-in" />
                ) : (
                  <Icon key="icon" name={s.icon} size={18} />
                )}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className={cn("truncate text-[15px]", on ? "font-semibold text-ink" : "font-medium text-ink")}>
                  {s.label}
                </span>
                <span
                  className={cn("truncate text-xs", !(done && !on) && "text-ink-muted")}
                  style={done && !on ? { color: COLOR.good } : undefined}
                >
                  {sub}
                </span>
              </span>
            </button>
            {k < STEPS.length - 1 && (
              <span
                aria-hidden
                className="ml-[29px] h-3 w-0.5 rounded-full transition-colors duration-500"
                style={{ background: done ? alpha(s.color, 0.6) : COLOR.track }}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The steps across the top on a phone: each its icon in a dot, the current one in its colour, its name under. */
export function StepDots({
  current,
  steps,
  onJump,
}: {
  current: StepId;
  steps: Marks;
  onJump: (step: StepId) => void;
}) {
  return (
    <ol className="m-0 flex list-none items-center gap-1.5 p-0" aria-label="Set-up steps">
      {STEPS.map((s, k) => {
        const on = s.id === current;
        const done = steps[s.id] === "done";
        return (
          <li key={s.id} className="flex min-w-0 flex-1 items-center gap-1.5 last:flex-none">
            <button
              type="button"
              aria-current={on ? "step" : undefined}
              aria-label={`${s.label}, ${on ? "current step" : done ? "done" : steps[s.id] === "skipped" ? "skipped" : "not started"}`}
              onClick={() => onJump(s.id)}
              className={cn(
                "flex size-9 flex-none items-center justify-center rounded-full border transition-[background-color,box-shadow] duration-300",
                on || done ? "border-transparent" : "border-line bg-surface text-ink-faint",
              )}
              style={
                on
                  ? { background: s.color, color: "var(--color-canvas)", boxShadow: `0 0 0 3px ${alpha(s.color, 0.2)}` }
                  : done
                    ? { background: alpha(s.color, 0.16), color: s.color }
                    : undefined
              }
            >
              <Icon name={done && !on ? "check" : s.icon} size={16} />
            </button>
            {k < STEPS.length - 1 && (
              <span
                aria-hidden
                className="h-0.5 min-w-2 flex-1 rounded-full transition-colors duration-500"
                style={{ background: done ? alpha(s.color, 0.6) : COLOR.track }}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
