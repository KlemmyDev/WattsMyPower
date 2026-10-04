import { useQuery } from "@tanstack/react-query";
import { carsQuery, suggestQuery } from "~/features/car/api";
import { CarLevelSlider, useCarLevels } from "~/features/car/components/CarLevel";
import type { CarView } from "~/features/car/types";
import {
  carName,
  chargeLine,
  costWords,
  MODE,
  paintOf,
  phaseWord,
  solarWords,
  stepsLine,
  when,
} from "~/features/car/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { pct } from "~/features/common/formatting/utils/number";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card, CardHeader, Eyebrow, Muted } from "~/features/common/ui/components/Card";
import { Pill } from "~/features/common/ui/components/Pill";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { sameDay } from "~/features/common/time/utils";

/**
 * The cars on the Overview, once any are connected: each one's level and range, and its next charge (planned, or
 * the best time to charge it), with the way to Plan for more. Two side by side; one, or more than two, a row each.
 */
export function CarCards({ now }: { now: number }) {
  const { data: cars } = useQuery(carsQuery);
  if (!cars?.length) return null;
  const pair = cars.length === 2;
  return cars.map((v) => <CarCard key={v.id} view={v} now={now} half={pair} />);
}

function CarCard({ view, now, half }: { view: CarView; now: number; half: boolean }) {
  const id = `h-car-card-${view.id}`;
  return (
    <Card aria-labelledby={id} className={half ? "col-span-6 max-lg:col-span-12" : "col-span-12"}>
      <CardHeader
        title={
          <span className="flex items-center gap-2.5">
            <i
              aria-hidden
              className="size-3 rounded-full border border-fg/20"
              style={{ background: paintOf(view.car.car_colour).hex }}
            />
            {carName(view)}
          </span>
        }
        id={id}
        action={
          <ButtonLink to="/plan" hash="car" variant="link" size="sm">
            Plan charging
          </ButtonLink>
        }
      />
      <div className={half ? "flex flex-col gap-6" : "grid grid-cols-2 gap-8 max-md:grid-cols-1 max-md:gap-6"}>
        <Level view={view} now={now} />
        <NextCharge view={view} now={now} />
      </div>
    </Card>
  );
}

/** The car's charge and the level it's charged to, set by dragging. */
function Level({ view, now }: { view: CarView; now: number }) {
  const levels = useCarLevels(view);
  return (
    <div className="flex flex-col gap-3">
      <Eyebrow>Charge</Eyebrow>
      <CarLevelSlider view={view} levels={levels} now={now} big />
    </div>
  );
}

/** A charge under way or still to come, else the best time to charge it to its usual level by its usual time. */
function NextCharge({ view, now }: { view: CarView; now: number }) {
  const next = view.charges.find((c) => c.end > now);
  // A plan's steps count as one charge: from its first step's start to its last's end.
  const steps = next?.plan != null ? view.charges.filter((c) => c.plan === next.plan) : next ? [next] : [];
  const planned = next && { ...steps[0], end: steps[steps.length - 1].end };
  const level = view.level?.soc;
  const target = view.car.car_target_soc;
  const wanted = !planned && level != null && level < target - 0.5;
  const { data: s, isPending, isError } = useQuery({ ...suggestQuery(view.id, {}), enabled: wanted });

  if (planned) {
    const on = planned.start <= now;
    return (
      <div className="flex flex-col gap-1.5">
        <Eyebrow>{on ? "Charging, as planned" : "Next charge"}</Eyebrow>
        <span className="flex flex-wrap items-center gap-2 text-[17px] font-medium tabular-nums">
          {on
            ? `Until ${sameDay(now, planned.end - 1) ? hhmm(planned.end) : when(planned.end, now)}`
            : `${when(planned.start, now)} to ${sameDay(planned.start, planned.end - 1) ? hhmm(planned.end) : when(planned.end, now)}`}
          {on && (
            <Pill tone="good" size="sm">
              Charging
            </Pill>
          )}
        </span>
        <Muted className="tabular-nums">
          {steps.length > 1 ? `${stepsLine(steps, now)} (${phaseWord(planned.phases)})` : chargeLine(planned)}
        </Muted>
      </div>
    );
  }
  if (level == null)
    return (
      <div className="flex flex-col gap-1.5">
        <Eyebrow>Best time to charge</Eyebrow>
        <Muted>Give the car's charge, and this shows the best time to charge it.</Muted>
      </div>
    );
  if (!wanted)
    return (
      <div className="flex flex-col gap-1.5">
        <Eyebrow>Best time to charge</Eyebrow>
        <span className="text-[17px] font-medium">No charge needed</span>
        <Muted>It's at or above the {target}% it's charged to.</Muted>
      </div>
    );
  // The plan for the aim set in the car's details; the first there is (the fastest) when that one can't make it.
  const best = s?.options.find((o) => o.kind === view.car.car_charge_mode) ?? s?.options[0];
  return (
    <div className="flex flex-col gap-1.5">
      <Eyebrow>Best time to charge</Eyebrow>
      {isPending ? (
        <Skeleton className="h-[72px]" />
      ) : isError || !s || !best ? (
        <Muted>Suggestions aren't available right now. Plan has the forecast.</Muted>
      ) : (
        <>
          <span className="text-[17px] font-medium tabular-nums">
            {when(best.start, now)} to {sameDay(best.start, best.end - 1) ? hhmm(best.end) : when(best.end, now)}
          </span>
          <Muted className="tabular-nums">
            {best.steps.length > 1 ? stepsLine(best.steps, now) : `${best.amps} A ${phaseWord(best.phases)}`} to{" "}
            {pct(best.soc_to)}
            {s.reachable ? ` by ${when(s.ready_by, now)}` : ` (not ${pct(s.soc_to)} in time)`} · costs{" "}
            {costWords(best.cost)} · {solarWords(best)}
          </Muted>
          <span className="text-xs text-ink-faint">
            {s.reachable
              ? `Aiming for: ${MODE[best.kind].label.toLowerCase()}`
              : `Starting now at full speed: it can't reach ${pct(s.soc_to)} by ${when(s.ready_by, now)}, so there's no ${MODE[view.car.car_charge_mode].label.toLowerCase()} plan to choose`}
          </span>
        </>
      )}
    </div>
  );
}
