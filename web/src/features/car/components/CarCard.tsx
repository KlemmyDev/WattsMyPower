import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { carQuery, suggestQuery } from "~/features/car/api";
import { LevelBar, LevelForm, levelSource, rangeWords } from "~/features/car/components/CarLevel";
import type { CarView } from "~/features/car/types";
import { carName, chargeLine, costWords, phaseWord, solarWords, when } from "~/features/car/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { pct } from "~/features/common/formatting/utils/number";
import { Button, ButtonLink } from "~/features/common/ui/components/Button";
import { BigNumber, Card, CardHeader, Eyebrow, Muted } from "~/features/common/ui/components/Card";
import { Pill } from "~/features/common/ui/components/Pill";
import { Skeleton } from "~/features/common/ui/components/Skeleton";

/**
 * The car on the Overview, once one is connected: its level and range, and its next charge (planned, or the best
 * time to charge it), with the way to Plan for more.
 */
export function CarCard({ now }: { now: number }) {
  const { data } = useQuery(carQuery);
  if (!data?.connected) return null;
  return (
    <Card aria-labelledby="h-car-card" className="col-span-12">
      <CardHeader
        title={carName(data)}
        id="h-car-card"
        action={
          <ButtonLink to="/plan" hash="car" variant="link" size="sm">
            Plan charging
          </ButtonLink>
        }
      />
      <div className="grid grid-cols-2 gap-8 max-md:grid-cols-1 max-md:gap-6">
        <Level view={data} now={now} />
        <NextCharge view={data} now={now} />
      </div>
    </Card>
  );
}

function Level({ view, now }: { view: CarView; now: number }) {
  const [editing, setEditing] = useState(false);
  const l = view.level;
  const target = view.car.car_target_soc;
  return (
    <div className="flex flex-col gap-3">
      <Eyebrow>Charge</Eyebrow>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <BigNumber>{l ? pct(l.soc) : "—"}</BigNumber>
        {l && <span className="pb-2 text-sm text-ink-muted tabular-nums">{rangeWords(l)}</span>}
      </div>
      <LevelBar soc={l?.soc ?? null} target={target} />
      {editing || !l ? (
        <LevelForm initial={l?.soc ?? null} onDone={l ? () => setEditing(false) : undefined} />
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Muted>{levelSource(l, now)}.</Muted>
          <Button variant="link" size="sm" onClick={() => setEditing(true)}>
            Update
          </Button>
        </div>
      )}
    </div>
  );
}

/** A charge under way or still to come, else the best time to charge it to its usual level by its usual time. */
function NextCharge({ view, now }: { view: CarView; now: number }) {
  const planned = view.charges.find((c) => c.end > now);
  const level = view.level?.soc;
  const target = view.car.car_target_soc;
  const wanted = !planned && level != null && level < target - 0.5;
  const { data: s, isPending, isError } = useQuery({ ...suggestQuery({}), enabled: wanted });

  if (planned) {
    const on = planned.start <= now;
    return (
      <div className="flex flex-col gap-1.5">
        <Eyebrow>{on ? "Charging, as planned" : "Next charge"}</Eyebrow>
        <span className="flex flex-wrap items-center gap-2 text-[17px] font-medium tabular-nums">
          {on ? `Until ${hhmm(planned.end)}` : `${when(planned.start, now)} to ${hhmm(planned.end)}`}
          {on && (
            <Pill tone="good" size="sm">
              Charging
            </Pill>
          )}
        </span>
        <Muted className="tabular-nums">{chargeLine(planned)}</Muted>
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
  const best = s?.options[0];
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
            {when(best.start, now)} to {hhmm(best.end)}
          </span>
          <Muted className="tabular-nums">
            {best.amps} A {phaseWord(best.phases)} to {pct(best.soc_to)}
            {s.reachable ? ` by ${when(s.ready_by, now)}` : ` (not ${pct(s.soc_to)} in time)`} · costs{" "}
            {costWords(best.cost)} · {solarWords(best)}
          </Muted>
        </>
      )}
    </div>
  );
}
