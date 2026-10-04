import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { carQuery, estimateQuery } from "~/features/car/api";
import { LevelBar, LevelForm, levelSource, rangeWords } from "~/features/car/components/CarLevel";
import { SuggestedCharges } from "~/features/car/components/SuggestedCharges";
import { useChargeChange } from "~/features/car/hooks";
import type { CarDetails, CarView, ChargeEstimate, ChargeRequest, PlannedCharge } from "~/features/car/types";
import { carName, chargeLine, fromLocal, toLocal, when } from "~/features/car/utils";
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
import { midnight } from "~/features/common/time/utils";

/** A sensible start: tonight at 22:00 if that's still ahead, else the next quarter hour. */
function defaultStart(now: number): number {
  const tonight = midnight(now) + 22 * 3600;
  return tonight > now + 900 ? tonight : Math.ceil(now / 900) * 900;
}

/**
 * The car on the Plan page. Connected: its level, the best times to charge it, and charges planned. Either way, a
 * charge can be planned by hand, and the forecast counts planned charges as home use: the battery, grid use and
 * costs on this page and the Overview include them.
 */
export function CarCharging() {
  const { data } = useQuery(carQuery);
  const now = useNow();
  const [planning, setPlanning] = useState(false);
  const { remove } = useChargeChange();
  const charges = data?.charges ?? [];
  const connected = !!data?.connected;
  return (
    <Card id="car" aria-labelledby="h-car" className="scroll-mt-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TitleBlock
          id="h-car"
          title={connected ? `Charging ${carName(data)}` : "Car charging"}
          sub={
            connected
              ? "When to charge it for the least on your bill, and the charges planned, which the forecast counts as home use"
              : "Plan when the car will charge, and the forecast counts it as home use"
          }
        />
        {!planning && (
          <Button variant="outline" size="sm" onClick={() => setPlanning(true)} disabled={!data}>
            <Icon name="plus" size={16} />
            {connected ? "Plan your own" : "Plan a charge"}
          </Button>
        )}
      </div>
      {data && connected && <LevelLine view={data} now={now} />}
      {data && connected && <SuggestedCharges key={data.level?.given_at ?? 0} view={data} now={now} />}
      {data && !connected && (
        <Notice tone="plain" className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-pretty">
            Connect your EV and this suggests when to charge it: from spare solar where it can, at the cheapest rates
            where it can't.
          </span>
          <ButtonLink to="/settings/integrations/car" variant="outline" size="sm">
            Connect your EV
          </ButtonLink>
        </Notice>
      )}
      {planning && data && (
        <ChargeForm car={data.car} level={data.level?.soc ?? null} now={now} onDone={() => setPlanning(false)} />
      )}
      {charges.length > 0 ? (
        <div className="flex flex-col gap-2">
          {connected && <h3 className="text-[15px] font-semibold">Planned charges</h3>}
          <ul className="flex flex-col">
            {charges.map((c) => (
              <ChargeRow key={c.id} c={c} now={now} onRemove={() => remove.mutate(c.id)} removing={remove.isPending} />
            ))}
          </ul>
        </div>
      ) : (
        !planning && !connected && <Muted>No charges planned.</Muted>
      )}
      {data && (
        <div className="flex flex-wrap items-center gap-x-2 border-t border-line-subtle pt-4 text-[13px] text-ink-muted">
          <span>
            {data.car.car_battery_kwh} kWh battery, {data.car.car_efficiency}% efficient, up to {data.car.car_amps} A
          </span>
          <ButtonLink to="/settings/integrations/car" variant="link" size="sm">
            Car details
          </ButtonLink>
        </div>
      )}
    </Card>
  );
}

/** The car's level: a bar, the figure, where it came from, and a way to give it afresh. */
function LevelLine({ view, now }: { view: CarView; now: number }) {
  const [editing, setEditing] = useState(!view.level);
  const l = view.level;
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm text-ink-muted tabular-nums">
          <b className="text-[22px] font-light tracking-[-0.5px] text-ink">{l ? pct(l.soc) : "—"}</b>
          {l ? ` · ${rangeWords(l)} · charged to ${view.car.car_target_soc}%` : " · the car's charge isn't known yet"}
        </span>
        {l && !editing && (
          <Button variant="link" size="sm" onClick={() => setEditing(true)}>
            Update
          </Button>
        )}
      </div>
      <LevelBar soc={l?.soc ?? null} target={view.car.car_target_soc} />
      {editing ? (
        <LevelForm initial={l?.soc ?? null} onDone={l ? () => setEditing(false) : undefined} />
      ) : (
        l && <Muted>{levelSource(l, now)}.</Muted>
      )}
    </div>
  );
}

function ChargeRow({
  c,
  now,
  onRemove,
  removing,
}: {
  c: PlannedCharge;
  now: number;
  onRemove: () => void;
  removing: boolean;
}) {
  const state = c.end <= now ? "Done" : c.start <= now ? "Charging" : null;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle py-3.5 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink tabular-nums">
          {when(c.start, now)} to {hhmm(c.end)}
          <span className="font-normal text-ink-muted">({duration(c.end - c.start)})</span>
          {state && (
            <Pill tone={state === "Charging" ? "good" : "neutral"} size="sm">
              {state}
            </Pill>
          )}
        </span>
        <span className="text-[13px] text-pretty text-ink-muted tabular-nums">
          {chargeLine(c)}
          {c.battery_helps ? "" : " · the home battery stays out of it"}
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
  car,
  level,
  now,
  onDone,
}: {
  car: CarDetails;
  level: number | null;
  now: number;
  onDone: () => void;
}) {
  const toast = useToast();
  const { add } = useChargeChange();
  const [start, setStart] = useState(() => toLocal(defaultStart(now)));
  const [socNow, setSocNow] = useState(level == null ? "" : String(Math.round(level)));
  const [stop, setStop] = useState<Stop>("level");
  const [socTo, setSocTo] = useState(String(car.car_target_soc));
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
    soc_now: num(socNow),
    soc_to: stop === "level" ? num(socTo) : null,
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
  const est = useQuery({ ...estimateQuery(asked), enabled: ready, placeholderData: keepPreviousData });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    add.mutate(req, {
      onSuccess: (c) => {
        toast(`Charge planned for ${when(c.start, now)}. The forecast now counts it.`);
        onDone();
      },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5 rounded-2xl bg-surface-inset p-5 max-sm:p-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] items-start gap-4">
        <Field label="Starts">
          <Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="The car's charge now" help={stop === "time" ? "Optional for a set time." : undefined}>
          <Input
            type="number"
            inputMode="decimal"
            min="0"
            max="100"
            unit="%"
            value={socNow}
            placeholder="e.g. 40"
            onChange={(e) => setSocNow(e.target.value)}
          />
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
              { value: "level", label: "At a charge level" },
              { value: "time", label: "After a set time" },
            ]}
            value={stop}
            onChange={setStop}
          />
        </div>
        {stop === "level" ? (
          <Field label="Charge to" className="w-[140px]" help="100 for full.">
            <Input
              type="number"
              inputMode="decimal"
              min="1"
              max="100"
              unit="%"
              value={socTo}
              onChange={(e) => setSocTo(e.target.value)}
            />
          </Field>
        ) : (
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
      <Muted>Give the car's charge now and a level to charge to, or a set time, to see what the charge comes to.</Muted>
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
