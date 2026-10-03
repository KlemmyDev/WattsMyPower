import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { carQuery, estimateQuery } from "~/features/car/api";
import { useChargeChange } from "~/features/car/hooks";
import type { CarDetails, ChargeEstimate, ChargeRequest, PlannedCharge } from "~/features/car/types";
import { errorMessage } from "~/features/common/api/utils";
import { duration, hhmm, weekdayLong } from "~/features/common/formatting/utils/date";
import { kWh, pct } from "~/features/common/formatting/utils/number";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { CAR_SETTINGS, type Settings } from "~/features/common/settings/types";
import { saveSettingsError } from "~/features/common/settings/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Card, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import { Icon } from "~/features/common/ui/components/Icon";
import { Pill } from "~/features/common/ui/components/Pill";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { Switch } from "~/features/common/ui/components/Switch";
import { useToast } from "~/features/common/ui/components/Toast";
import { useNow } from "~/features/common/time/hooks";
import { addDays, midnight } from "~/features/common/time/utils";

/** "Tonight 22:00", "Tomorrow 06:30", "Monday 18:00": when a charge starts, in words. */
function when(ts: number, now: number): string {
  const day = midnight(ts);
  const today = midnight(now);
  const name =
    day === today
      ? new Date(ts * 1000).getHours() >= 18
        ? "Tonight"
        : "Today"
      : day === addDays(today, 1)
        ? "Tomorrow"
        : weekdayLong.format(ts * 1000);
  return `${name} ${hhmm(ts)}`;
}

const phaseWord = (n: number) => (n === 3 ? "three-phase" : n === 1 ? "single phase" : `${n}-phase`);

/** A local "YYYY-MM-DDTHH:mm" for a datetime-local input, and back. */
const toLocal = (ts: number) => {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v: string) => Math.floor(new Date(v).getTime() / 1000);

/** A sensible start: tonight at 22:00 if that's still ahead, else the next quarter hour. */
function defaultStart(now: number): number {
  const tonight = midnight(now) + 22 * 3600;
  return tonight > now + 900 ? tonight : Math.ceil(now / 900) * 900;
}

/** One line for a charge: its power, the car's charge at each end, and the energy from the wall. */
function chargeLine(c: {
  amps: number;
  phases: number;
  power_kw: number;
  soc_from: number | null;
  soc_to: number | null;
  wall_kwh: number;
}) {
  const levels = c.soc_from != null && c.soc_to != null ? ` · ${pct(c.soc_from)} → ${pct(c.soc_to)}` : "";
  return `${c.amps} A ${phaseWord(c.phases)} (${c.power_kw.toFixed(1)} kW)${levels} · about ${kWh(c.wall_kwh)} from the wall`;
}

/**
 * Car charges planned ahead. Until the car can be charged from spare solar automatically, say when it
 * will charge and how, and the forecast counts it as home use: the battery, grid use and costs on this
 * page and the Overview include it.
 */
export function CarCharging() {
  const { data } = useQuery(carQuery);
  const now = useNow();
  const [planning, setPlanning] = useState(false);
  const [details, setDetails] = useState(false);
  const { remove } = useChargeChange();
  const charges = data?.charges ?? [];
  return (
    <Card aria-labelledby="h-car">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TitleBlock
          id="h-car"
          title="Car charging"
          sub="Plan when the car will charge, and the forecast counts it as home use"
        />
        {!planning && (
          <Button variant="outline" size="sm" onClick={() => setPlanning(true)} disabled={!data}>
            <Icon name="plus" size={16} />
            Plan a charge
          </Button>
        )}
      </div>
      {planning && data && <ChargeForm car={data.car} now={now} onDone={() => setPlanning(false)} />}
      {charges.length > 0 ? (
        <ul className="flex flex-col">
          {charges.map((c) => (
            <ChargeRow key={c.id} c={c} now={now} onRemove={() => remove.mutate(c.id)} removing={remove.isPending} />
          ))}
        </ul>
      ) : (
        !planning && <Muted>No charges planned.</Muted>
      )}
      <div className="flex flex-col gap-3 border-t border-line-subtle pt-4">
        <button
          type="button"
          aria-expanded={details}
          onClick={() => setDetails((v) => !v)}
          className="flex items-center gap-1.5 self-start border-0 bg-transparent p-0 text-[13px] font-semibold text-ink-muted hover:text-ink"
        >
          <Icon
            name="chevR"
            size={16}
            className={details ? "rotate-90 transition-transform" : "transition-transform"}
          />
          Car details
          {data && (
            <span className="font-normal text-ink-faint">
              · {data.car.car_battery_kwh} kWh battery, {data.car.car_efficiency}% efficient
            </span>
          )}
        </button>
        {details && data && <CarDetailsForm car={data.car} />}
      </div>
    </Card>
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
function ChargeForm({ car, now, onDone }: { car: CarDetails; now: number; onDone: () => void }) {
  const toast = useToast();
  const { add } = useChargeChange();
  const [start, setStart] = useState(() => toLocal(defaultStart(now)));
  const [socNow, setSocNow] = useState("");
  const [stop, setStop] = useState<Stop>("level");
  const [socTo, setSocTo] = useState("90");
  const [hours, setHours] = useState("3");
  const [amps, setAmps] = useState(String(car.car_amps));
  const [phases, setPhases] = useState(String(car.car_phases === 3 ? 3 : 1));
  const [helps, setHelps] = useState(true);
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

type Values = Record<(typeof CAR_SETTINGS)[number], string>;

/** The car's battery, how efficiently it charges, and how it's usually charged. */
function CarDetailsForm({ car }: { car: CarDetails }) {
  const save = useSaveSettings();
  const toast = useToast();
  const [values, setValues] = useState<Values>(
    () => Object.fromEntries(CAR_SETTINGS.map((k) => [k, String(car[k])])) as Values,
  );
  const [error, setError] = useState("");
  const changed = CAR_SETTINGS.filter((k) => Number(values[k]) !== car[k]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    const bad = changed.find((k) => values[k].trim() === "" || Number.isNaN(Number(values[k])));
    if (bad) return setError("Enter a number for each detail.");
    const changes: Partial<Settings> = Object.fromEntries(changed.map((k) => [k, Number(values[k])]));
    save.mutate(changes, {
      onSuccess: () => toast("Car details saved."),
      onError: (err) => setError(saveSettingsError(err)),
    });
  };
  const field = (k: keyof Values, label: string, unit: string, help: string) => (
    <Field label={label} help={help}>
      <Input
        type="number"
        inputMode="decimal"
        unit={unit}
        value={values[k]}
        onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))}
      />
    </Field>
  );
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] items-start gap-4">
        {field("car_battery_kwh", "Battery", "kWh", "Its usable size: the car's specs, or its app.")}
        {field("car_efficiency", "Charging efficiency", "%", "What reaches the battery: about 90% at home.")}
        {field("car_amps", "Usual current", "A", "What it usually charges at.")}
        {field("car_phases", "Usual phases", "", "1, or 3 on a three-phase socket.")}
        {field("car_voltage", "Voltage", "V", "230 in Australia.")}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={!changed.length || save.isPending}>
          {save.isPending ? "Saving…" : "Save car details"}
        </Button>
        <HelpText tone="bad" role="alert">
          {error}
        </HelpText>
      </div>
    </form>
  );
}
