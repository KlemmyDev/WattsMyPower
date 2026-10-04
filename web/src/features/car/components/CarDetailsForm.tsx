import { useState, type FormEvent, type ReactNode } from "react";
import type { CarDetails, ChargeMode, Weekday } from "~/features/car/types";
import { minutesToTime, MODE, MODES, timeToMinutes, WEEKDAYS } from "~/features/car/utils";
import { useSaveSettings } from "~/features/common/settings/hooks";
import type { Settings } from "~/features/common/settings/types";
import { saveSettingsError } from "~/features/common/settings/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input, Select } from "~/features/common/ui/components/Field";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { Switch } from "~/features/common/ui/components/Switch";
import { useToast } from "~/features/common/ui/components/Toast";
import { cn } from "~/features/common/ui/utils";

type NumberKey = Exclude<
  keyof CarDetails,
  "car_phases" | "car_ready_by" | "car_days" | "car_battery_helps" | "car_charge_mode"
>;
const NUMBERS: NumberKey[] = [
  "car_battery_kwh",
  "car_wh_per_km",
  "car_efficiency",
  "car_amps",
  "car_min_amps",
  "car_voltage",
  "car_target_soc",
];

type Values = Record<NumberKey, string> & {
  phases: "1" | "3";
  readyBy: string;
  days: Weekday[];
  helps: boolean;
  mode: ChargeMode;
};

const valuesOf = (car: CarDetails): Values => ({
  ...(Object.fromEntries(NUMBERS.map((k) => [k, String(car[k])])) as Record<NumberKey, string>),
  phases: car.car_phases === 3 ? "3" : "1",
  readyBy: minutesToTime(car.car_ready_by),
  days: car.car_days,
  helps: !!car.car_battery_helps,
  mode: car.car_charge_mode,
});

/** The form's values as settings. */
function settingsOf(v: Values): Partial<Settings> {
  return {
    ...Object.fromEntries(NUMBERS.map((k) => [k, Number(v[k])])),
    car_phases: Number(v.phases),
    car_ready_by: timeToMinutes(v.readyBy),
    // In the week's order, and none for every day.
    car_days: v.days.length === 7 ? [] : WEEKDAYS.filter((d) => v.days.includes(d)),
    car_battery_helps: v.helps ? 1 : 0,
    car_charge_mode: v.mode,
  };
}

function Group({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
      <legend className="mb-4 flex flex-col gap-0.5 p-0">
        <span className="text-[15px] font-semibold">{title}</span>
        <span className="text-[13px] text-ink-muted">{sub}</span>
      </legend>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] items-start gap-4">{children}</div>
    </fieldset>
  );
}

/**
 * The car's details: the car itself, how it's charged at home, and what it's charged to and by when. Saving sends
 * what changed (with `extra`, everything, plus `extra`: connecting a car saves the lot).
 */
export function CarDetailsForm({
  car,
  extra,
  submitLabel = "Save car details",
  onSaved,
  footer,
}: {
  car: CarDetails;
  extra?: Partial<Settings>;
  submitLabel?: string;
  onSaved?: () => void;
  footer?: ReactNode;
}) {
  const save = useSaveSettings();
  const toast = useToast();
  const [v, setV] = useState<Values>(() => valuesOf(car));
  const [error, setError] = useState("");
  const all = settingsOf(v);
  const before = settingsOf(valuesOf(car));
  const changed = (Object.keys(all) as (keyof Settings)[]).filter(
    (k) => JSON.stringify(all[k]) !== JSON.stringify(before[k]),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (NUMBERS.some((k) => v[k].trim() === "" || Number.isNaN(Number(v[k]))))
      return setError("Enter a number for each detail.");
    if (!/^\d\d:\d\d$/.test(v.readyBy)) return setError("Give a time the car's usually needed by.");
    const changes = extra ? { ...all, ...extra } : Object.fromEntries(changed.map((k) => [k, all[k]]));
    save.mutate(changes, {
      onSuccess: () => {
        if (!extra) toast("Car details saved.");
        onSaved?.();
      },
      onError: (err) => setError(saveSettingsError(err)),
    });
  };
  const set = (k: keyof Values) => (e: { target: { value: string } }) => setV((o) => ({ ...o, [k]: e.target.value }));
  const num = (k: NumberKey, label: string, unit: string, help: ReactNode) => (
    <Field label={label} help={help}>
      <Input type="number" inputMode="decimal" unit={unit} value={v[k]} onChange={set(k)} />
    </Field>
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-7">
      <Group title="The car" sub="Its battery, and what it uses on the road.">
        {num("car_battery_kwh", "Battery", "kWh", "Its usable size: the car's specs, or its app.")}
        {num("car_wh_per_km", "Energy use", "Wh/km", "The trip screen's average. 150 to 200 is usual.")}
        {num("car_efficiency", "Charging efficiency", "%", "What reaches the battery: about 90% at home.")}
      </Group>
      <Group title="Charging at home" sub="What your charger gives, and what the car takes.">
        {num("car_amps", "Most current", "A", "The charger's or cable's limit, or the car's if lower.")}
        {num("car_min_amps", "Lowest current", "A", "5 A for a Tesla, 6 A for most others.")}
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Phases</span>
          <Segmented
            label="Phases"
            className="self-start"
            options={[
              { value: "1", label: "Single" },
              { value: "3", label: "Three" },
            ]}
            value={v.phases}
            onChange={(phases) => setV((o) => ({ ...o, phases }))}
          />
          <span className="text-xs text-ink-muted">Three on a three-phase charger, if the car takes three.</span>
        </div>
        {num("car_voltage", "Voltage", "V", "230 in Australia.")}
      </Group>
      <Group title="Day to day" sub="Where suggested charges stop, when they finish by, and what they aim for.">
        {num("car_target_soc", "Charge to", "%", "80 or 90 day to day; 100 for an LFP battery.")}
        <Field label="Usually needed by" help="Suggestions finish before this time.">
          <Input type="time" value={v.readyBy} onChange={set("readyBy")} />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span id="car-days" className="text-[13px] font-semibold">
            On
          </span>
          <div role="group" aria-labelledby="car-days" className="flex flex-wrap gap-1">
            {WEEKDAYS.map((d) => {
              const on = !v.days.length || v.days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setV((o) => {
                      const was = o.days.length ? o.days : WEEKDAYS;
                      const days = was.includes(d) ? was.filter((x) => x !== d) : [...was, d];
                      return { ...o, days: days.length ? days : was };
                    })
                  }
                  className={cn(
                    "h-9 w-10 rounded-full border text-[13px] font-semibold capitalize transition-colors",
                    on ? "border-ink bg-ink text-ink-inverse" : "border-line bg-surface text-ink-muted hover:text-ink",
                  )}
                >
                  {d.slice(0, 2)}
                </button>
              );
            })}
          </div>
          <span className="text-xs text-ink-muted">
            The days it's needed. On a week off, charging can wait for the sunniest days.
          </span>
        </div>
        <Field label="Aim for" help={MODE[v.mode].about}>
          <Select value={v.mode} onChange={(e) => setV((o) => ({ ...o, mode: e.target.value as ChargeMode }))}>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {MODE[m].label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex items-start justify-between gap-4 sm:col-span-2">
          <div className="flex flex-col gap-0.5">
            <span id="car-helps-setting" className="text-[13px] font-semibold">
              Let the home battery help
            </span>
            <span className="text-xs text-pretty text-ink-muted">
              Your inverter normally discharges the battery into the car. Turn this off if you've set it not to, so
              suggestions count only solar and the grid.
            </span>
          </div>
          <Switch
            on={v.helps}
            onChange={(helps) => setV((o) => ({ ...o, helps }))}
            aria-labelledby="car-helps-setting"
          />
        </div>
      </Group>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={(!extra && !changed.length) || save.isPending}>
          {save.isPending ? "Saving…" : submitLabel}
        </Button>
        {footer}
        <HelpText tone="bad" role="alert">
          {error}
        </HelpText>
      </div>
    </form>
  );
}
