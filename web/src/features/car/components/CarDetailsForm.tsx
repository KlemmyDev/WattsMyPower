import { useState, type FormEvent, type ReactNode } from "react";
import { useCarChange } from "~/features/car/hooks";
import type { CarBody, CarColour, CarDetails, CarView } from "~/features/car/types";
import { BODY, BODIES, PAINT, paintOf, PAINTS } from "~/features/car/utils";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input, Select } from "~/features/common/ui/components/Field";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { useToast } from "~/features/common/ui/components/Toast";
import { cn } from "~/features/common/ui/utils";

type NumberKey = Exclude<keyof CarDetails, "car_phases" | "car_colour" | "car_body" | "car_park">;
const NUMBERS: NumberKey[] = ["car_battery_kwh", "car_wh_per_km", "car_amps", "car_min_amps", "car_voltage"];

type Values = Record<NumberKey, string> & {
  phases: "1" | "3";
  colour: CarColour;
  body: CarBody;
  park: "garage" | "outside";
};

const valuesOf = (car: CarDetails): Values => ({
  ...(Object.fromEntries(NUMBERS.map((k) => [k, String(car[k])])) as Record<NumberKey, string>),
  phases: car.car_phases === 3 ? "3" : "1",
  colour: car.car_colour,
  body: car.car_body,
  park: car.car_park,
});

/** The form's values as the car's details. */
function detailsOf(v: Values): Partial<CarDetails> {
  return {
    ...Object.fromEntries(NUMBERS.map((k) => [k, Number(v[k])])),
    car_phases: Number(v.phases),
    car_colour: v.colour,
    car_body: v.body,
    car_park: v.park,
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
 * A car's details: the car itself, how it's charged at home, and how the Overview draws it. Saving sends what changed;
 * given its name and model (`identity`), it sends them and every detail, changing which car it is.
 */
export function CarDetailsForm({
  car,
  id,
  identity,
  submitLabel = "Save car details",
  onSaved,
  footer,
}: {
  car: CarDetails;
  id: number;
  identity?: { name: string | null; model: string | null };
  submitLabel?: string;
  onSaved?: (car: CarView) => void;
  footer?: ReactNode;
}) {
  const { update } = useCarChange();
  const save = update;
  const toast = useToast();
  const [v, setV] = useState<Values>(() => valuesOf(car));
  const [error, setError] = useState("");
  const all = detailsOf(v);
  const before = detailsOf(valuesOf(car));
  const changed = (Object.keys(all) as (keyof CarDetails)[]).filter(
    (k) => JSON.stringify(all[k]) !== JSON.stringify(before[k]),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (NUMBERS.some((k) => v[k].trim() === "" || Number.isNaN(Number(v[k]))))
      return setError("Enter a number for each detail.");
    const done = {
      onSuccess: (saved: CarView) => {
        if (!identity) toast("Car details saved.");
        onSaved?.(saved);
      },
      onError: (err: unknown) => setError(errorMessage(err)),
    };
    if (identity) update.mutate({ id, ...all, ...identity }, done);
    else update.mutate({ id, ...Object.fromEntries(changed.map((k) => [k, all[k]])) }, done);
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
        {num("car_voltage", "Voltage", "V", "230 in Australia. A Tesla's own reading is used once it charges.")}
      </Group>
      <Group title="On the Overview" sub="How the drawing of your house shows it.">
        <div className="flex flex-col gap-1.5">
          <span id="car-paint" className="text-[13px] font-semibold">
            Paint
          </span>
          <div role="radiogroup" aria-labelledby="car-paint" className="flex flex-wrap gap-1.5">
            {PAINTS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={v.colour === c}
                aria-label={PAINT[c].label}
                title={PAINT[c].label}
                onClick={() => setV((o) => ({ ...o, colour: c }))}
                className={cn(
                  "size-8 rounded-full border border-fg/20 transition-shadow",
                  v.colour === c && "shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-ink)]",
                )}
                style={{ background: PAINT[c].hex }}
              />
            ))}
            <label
              title="A colour of its own"
              className={cn(
                "relative flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-fg/20 transition-shadow",
                v.colour.startsWith("#") && "shadow-[0_0_0_2px_var(--color-surface),0_0_0_4px_var(--color-ink)]",
              )}
              style={{
                background: v.colour.startsWith("#") ? v.colour : "conic-gradient(#e44,#ec4,#4c6,#4ae,#a4e,#e44)",
              }}
            >
              <span className="sr-only">A colour of its own</span>
              <input
                type="color"
                value={paintOf(v.colour).hex}
                onChange={(e) => setV((o) => ({ ...o, colour: e.target.value as CarColour }))}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
            </label>
          </div>
          <span className="text-xs text-ink-muted">
            {paintOf(v.colour).label}
            {v.colour.startsWith("#") ? ` (${v.colour})` : ""}
          </span>
        </div>
        <Field label="Drawn as" help="Its own shape for some popular models; a sedan, SUV or hatch for the rest.">
          <Select value={v.body} onChange={(e) => setV((o) => ({ ...o, body: e.target.value as CarBody }))}>
            {BODIES.map((b) => (
              <option key={b} value={b}>
                {BODY[b]}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Parks</span>
          <Segmented
            label="Parks"
            className="self-start"
            options={[
              { value: "garage", label: "In the garage" },
              { value: "outside", label: "Outside" },
            ]}
            value={v.park}
            onChange={(park) => setV((o) => ({ ...o, park }))}
          />
          <span className="text-xs text-ink-muted">Outside if there's no garage, or no room left in it.</span>
        </div>
      </Group>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="sm" disabled={(!identity && !changed.length) || save.isPending}>
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
