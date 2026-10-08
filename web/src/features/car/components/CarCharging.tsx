import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { carsQuery, estimateQuery } from "~/features/car/api";
import { CarLevelSlider, useCarLevels, type CarLevels } from "~/features/car/components/CarLevel";
import { SuggestedCharges } from "~/features/car/components/SuggestedCharges";
import { useChargeChange } from "~/features/car/hooks";
import type { CarDetails, CarView, ChargeEstimate, ChargeRequest, PlannedCharge } from "~/features/car/types";
import { carName, chargeLine, fromLocal, phaseWord, stepsLine, toLocal, when } from "~/features/car/utils";
import { errorMessage } from "~/features/common/api/utils";
import { duration, hhmm } from "~/features/common/formatting/utils/date";
import { kWh, pct } from "~/features/common/formatting/utils/number";
import { Button, ButtonLink } from "~/features/common/ui/components/Button";
import { Card, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { Pill } from "~/features/common/ui/components/Pill";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { Switch } from "~/features/common/ui/components/Switch";
import { useToast } from "~/features/common/ui/components/Toast";
import { useNow } from "~/features/common/time/hooks";
import { midnight, sameDay } from "~/features/common/time/utils";

/** A sensible start: tonight at 22:00 if that's still ahead, else the next quarter hour. */
function defaultStart(now: number): number {
  const tonight = midnight(now) + 22 * 3600;
  return tonight > now + 900 ? tonight : Math.ceil(now / 900) * 900;
}

/**
 * The cars on the Plan page: for the one chosen (when there's more than one), its level, the best times to charge
 * it, and a charge planned by hand; then every car's planned charges, which the forecast counts as home use, so the
 * battery, grid use and costs on this page and the Overview include them.
 */
export function CarCharging() {
  const { data: cars } = useQuery(carsQuery);
  const now = useNow();
  const [planning, setPlanning] = useState(false);
  const [chosen, setChosen] = useState<number | null>(null);
  const { remove } = useChargeChange();
  const view = cars?.find((c) => c.id === chosen) ?? cars?.[0];
  const charges = (cars ?? []).flatMap((c) => c.charges).sort((a, b) => a.start - b.start);
  const names = new Map((cars ?? []).map((c) => [c.id, carName(c)]));
  return (
    <Card id="car" aria-labelledby="h-car" className="scroll-mt-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TitleBlock
          id="h-car"
          title={view && cars?.length === 1 ? `Charging ${carName(view)}` : "Car charging"}
          sub="When to charge for the least on your bill, and the charges planned, which the forecast counts as home use"
        />
        {view && !planning && (
          <Button variant="outline" size="sm" onClick={() => setPlanning(true)}>
            <Icon name="plus" size={16} />
            Plan your own
          </Button>
        )}
      </div>
      {cars && cars.length > 1 && view && (
        <Segmented
          label="Car"
          className="self-start max-sm:self-stretch max-sm:overflow-x-auto"
          options={cars.map((c) => ({ value: String(c.id), label: carName(c) }))}
          value={String(view.id)}
          onChange={(v) => {
            setChosen(Number(v));
            setPlanning(false);
          }}
        />
      )}
      {view && (
        <CarPlanner key={view.id} view={view} now={now} planning={planning} onPlanned={() => setPlanning(false)} />
      )}
      {cars && !view && (
        <Notice tone="plain" className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-pretty">
            Connect your EV and this suggests when to charge it: from spare solar where it can, at the cheapest rates
            where it can't.
          </span>
          <ButtonLink to="/integrations/car" variant="outline" size="sm">
            Connect your EV
          </ButtonLink>
        </Notice>
      )}
      {charges.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-[15px] font-semibold">Planned charges</h3>
          <ul className="flex flex-col">
            {byPlan(charges).map((steps) => (
              <ChargeRow
                key={steps[0].id}
                steps={steps}
                name={cars && cars.length > 1 ? names.get(steps[0].car) : undefined}
                now={now}
                onRemove={() => remove.mutate(steps[0].id)}
                removing={remove.isPending}
              />
            ))}
          </ul>
        </div>
      )}
      {view && (
        <div className="flex flex-wrap items-center gap-x-2 border-t border-line-subtle pt-4 text-[13px] text-ink-muted">
          <span>
            {view.car.car_battery_kwh} kWh battery, {view.car.car_efficiency}% efficient, up to {view.car.car_amps} A
          </span>
          <ButtonLink to="/integrations/car/$carId" params={{ carId: String(view.id) }} variant="link" size="sm">
            Car details
          </ButtonLink>
        </div>
      )}
    </Card>
  );
}

/**
 * One car's charge on a slider (the charge now and the level to charge to, saved as they're dragged), the best
 * times to charge it between the two, and a charge planned by hand, which starts from the same two figures.
 */
function CarPlanner({
  view,
  now,
  planning,
  onPlanned,
}: {
  view: CarView;
  now: number;
  planning: boolean;
  onPlanned: () => void;
}) {
  const levels = useCarLevels(view);
  return (
    <>
      <CarLevelSlider view={view} levels={levels} now={now} />
      <SuggestedCharges view={view} now={now} socNow={levels.committed.soc} socTo={levels.committed.target} />
      {planning && <ChargeForm carId={view.id} car={view.car} levels={levels} now={now} onDone={onPlanned} />}
    </>
  );
}

/** Planned charges as the list shows them: a plan's steps together, each charge on its own otherwise. */
function byPlan(charges: PlannedCharge[]): PlannedCharge[][] {
  const out: PlannedCharge[][] = [];
  const plans = new Map<number, PlannedCharge[]>();
  for (const c of charges) {
    if (c.plan == null) out.push([c]);
    else if (plans.has(c.plan)) plans.get(c.plan)!.push(c);
    else {
      const steps = [c];
      plans.set(c.plan, steps);
      out.push(steps);
    }
  }
  return out;
}

/** A planned charge, or a plan's steps: when, how fast, the car's level at each end, and a way to remove it. */
function ChargeRow({
  steps,
  name,
  now,
  onRemove,
  removing,
}: {
  steps: PlannedCharge[];
  /** The car's name, with more than one car. */
  name?: string;
  now: number;
  onRemove: () => void;
  removing: boolean;
}) {
  const first = steps[0];
  const last = steps[steps.length - 1];
  const state = last.end <= now ? "Done" : first.start <= now ? "Charging" : null;
  const wall = steps.reduce((a, c) => a + c.wall_kwh, 0);
  const levels = first.soc_from != null && last.soc_to != null ? ` · ${pct(first.soc_from)} → ${pct(last.soc_to)}` : "";
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle py-3.5 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink tabular-nums">
          {name && <span className="font-semibold">{name}:</span>}
          {when(first.start, now)} to {sameDay(first.start, last.end - 1) ? hhmm(last.end) : when(last.end, now)}
          {sameDay(first.start, last.end - 1) && (
            <span className="font-normal text-ink-muted">({duration(last.end - first.start)})</span>
          )}
          {state && (
            <Pill tone={state === "Charging" ? "good" : "neutral"} size="sm">
              {state}
            </Pill>
          )}
        </span>
        <span className="text-[13px] text-pretty text-ink-muted tabular-nums">
          {steps.length > 1
            ? `${stepsLine(steps, now)} (${phaseWord(first.phases)})${levels} · about ${kWh(wall)} from the wall`
            : chargeLine(first)}
          {first.battery_helps ? "" : " · the home battery stays out of it"}
        </span>
      </div>
      <Button variant="chip" onClick={onRemove} disabled={removing}>
        Remove
      </Button>
    </li>
  );
}

type Stop = "level" | "time";

/** Plan a charge: when it starts, how it stops, how fast, and whether the home battery helps; with what it comes to. */
function ChargeForm({
  carId,
  car,
  levels,
  now,
  onDone,
}: {
  carId: number;
  car: CarDetails;
  /** The car's charge now and the level to charge to, from the slider. */
  levels: CarLevels;
  now: number;
  onDone: () => void;
}) {
  const toast = useToast();
  const { add } = useChargeChange();
  const [start, setStart] = useState(() => toLocal(defaultStart(now)));
  const [stop, setStop] = useState<Stop>("level");
  const [hours, setHours] = useState("3");
  const [amps, setAmps] = useState(String(car.car_amps));
  const [phases, setPhases] = useState(String(car.car_phases === 3 ? 3 : 1));
  const [helps, setHelps] = useState(!!car.car_battery_helps);
  const [error, setError] = useState("");

  const num = (v: string) => (v.trim() === "" || Number.isNaN(Number(v)) ? null : Number(v));
  const req: ChargeRequest = {
    start: start ? fromLocal(start) : 0,
    amps: num(amps) ?? 0,
    phases: Number(phases),
    soc_now: levels.committed.soc,
    soc_to: stop === "level" ? levels.committed.target : null,
    hours: stop === "time" ? num(hours) : null,
    battery_helps: helps,
  };
  // The estimate follows the form, a moment after typing stops.
  const [asked, setAsked] = useState(req);
  const key = JSON.stringify(req);
  useEffect(() => {
    const t = setTimeout(() => setAsked(JSON.parse(key)), 250);
    return () => clearTimeout(t);
  }, [key]);
  const ready =
    asked.start > 0 && asked.amps > 0 && (asked.hours != null || (asked.soc_now != null && asked.soc_to != null));
  const est = useQuery({ ...estimateQuery(carId, asked), enabled: ready, placeholderData: keepPreviousData });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    add.mutate(
      { car: carId, ...req },
      {
        onSuccess: (c) => {
          toast(`Charge planned for ${when(c.start, now)}. The forecast now counts it.`);
          onDone();
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5 rounded-2xl bg-surface-inset p-5 max-sm:p-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] items-start gap-4">
        <Field label="Starts">
          <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Current">
          <Input
            type="number"
            inputMode="decimal"
            min="1"
            max="48"
            unit="A"
            value={amps}
            onChange={(e) => setAmps(e.target.value)}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Stops</span>
          <Segmented<Stop>
            label="Stops"
            options={[
              { value: "level", label: `At ${levels.target}%` },
              { value: "time", label: "After a set time" },
            ]}
            value={stop}
            onChange={setStop}
          />
        </div>
        {stop === "time" && (
          <Field label="For" className="w-[140px]" help="Stops early if the car fills.">
            <Input
              type="number"
              inputMode="decimal"
              min="0.25"
              max="48"
              step="0.25"
              unit="hours"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
            />
          </Field>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Phases</span>
          <Segmented
            label="Phases"
            options={[
              { value: "1", label: "Single" },
              { value: "3", label: "Three" },
            ]}
            value={phases}
            onChange={setPhases}
          />
        </div>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span id="car-helps" className="text-sm font-semibold">
            Let the home battery help
          </span>
          <span className="text-[13px] text-pretty text-ink-muted">
            Your inverter normally discharges the battery into the car. Turn this off if you've set it not to, so the
            car's power comes from solar and the grid only.
          </span>
        </div>
        <Switch on={helps} onChange={setHelps} aria-labelledby="car-helps" />
      </div>
      <Estimate est={ready ? est.data : undefined} error={ready && est.isError ? errorMessage(est.error) : ""} />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={!ready || est.isError || add.isPending}>
          {add.isPending ? "Planning…" : "Plan this charge"}
        </Button>
        <Button type="button" variant="muted-link" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <HelpText tone="bad" role="alert">
          {error}
        </HelpText>
      </div>
    </form>
  );
}

/** What the charge in the form comes to, as it's filled in. */
function Estimate({ est, error }: { est: ChargeEstimate | undefined; error: string }) {
  if (error) return <HelpText tone="bad">{error}</HelpText>;
  if (!est)
    return (
      <Muted>Set the car's charge on the slider above, or choose a set time, to see what the charge comes to.</Muted>
    );
  const figures: [string, string][] = [
    ["Power", `${est.power_kw.toFixed(1)} kW`],
    ["Takes", duration(est.end - est.start)],
    ["Finishes", hhmm(est.end)],
    ["From the wall", kWh(est.wall_kwh)],
    ["Into the car", `${kWh(est.car_kwh)}${est.soc_to != null ? ` (to ${pct(est.soc_to)})` : ""}`],
  ];
  return (
    <dl className="m-0 grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-px overflow-hidden rounded-xl bg-line-subtle">
      {figures.map(([k, v]) => (
        <div key={k} className="flex flex-col gap-0.5 bg-surface px-4 py-3">
          <dt className="text-xs text-ink-muted">{k}</dt>
          <dd className="m-0 text-[15px] font-medium tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
