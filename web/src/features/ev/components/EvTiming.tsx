import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { duration } from "~/features/common/formatting/utils/date";
import { Button } from "~/features/common/ui/components/Button";
import { Collapse } from "~/features/common/ui/components/Collapse";
import { CardText, ChoiceTiles, SmallCard, type Choice } from "~/features/common/ui/components/SmallCard";
import { bluelinkQuery, teslaQuery } from "~/features/ev/api";
import { useEvChange } from "~/features/ev/hooks";
import type { EvBrand, EvTimingKey, EvVehicle } from "~/features/ev/types";
import { COLOR } from "~/features/common/theme/utils/colors";

/** A wait in seconds, in words: "45 s", "1 min 30 s", "3 min", "1 h 30 min". */
function span(secs: number): string {
  if (secs < 60) return `${secs} s`;
  if (secs >= 3600) return duration(secs);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

type Row = {
  key: EvTimingKey;
  label: string;
  about: string;
  /** Slider step, in the setting's own unit. */
  step: number;
  shown: (secs: number) => string;
};

const ROWS: Row[] = [
  {
    key: "start_after",
    label: "Wait before starting",
    about: "How long there has to be enough spare sun before it starts charging.",
    step: 30,
    shown: (s) => (s ? span(s) : "Straight away"),
  },
  {
    key: "stop_after",
    label: "Wait before stopping",
    about: "How long it keeps charging after spare sun runs out (counting what it can borrow) before it stops.",
    step: 30,
    shown: (s) => (s ? span(s) : "Straight away"),
  },
  {
    key: "min_switch",
    label: "Minimum time between start and stop",
    about: "Each start or stop wakes the car and clicks its charge port, so they shouldn't come too close together.",
    step: 60,
    shown: span,
  },
  {
    key: "amps_every",
    label: "Change speed at most every",
    about: "How often it may step the charging speed up or down to follow the sun.",
    step: 10,
    shown: span,
  },
  {
    key: "average",
    label: "Average the spare sun over",
    about: "Longer rides out passing clouds; shorter follows the sun more closely.",
    step: 10,
    shown: span,
  },
  {
    key: "lead",
    label: "Get the car ready before the sun",
    about:
      "How early before spare sun to start checking the car each minute (and waking it, over Bluetooth), so it starts without delay.",
    step: 300,
    shown: (s) => (s ? `${span(s)} before` : "Only once there's sun"),
  },
  {
    key: "battery_full",
    label: "Home battery counts as full at",
    about: "With your home battery first, the car gets spare sun once the battery's at least this full.",
    step: 1,
    shown: (p) => `${p}%`,
  },
];

/** One timing as a slider: shown as it moves, saved once it's let go; set back to its default with Reset. */
function TimingRow({
  row,
  value,
  limits,
  onSave,
}: {
  row: Row;
  value: number;
  limits: { default: number; min: number; max: number };
  onSave: (value: number | null) => void;
}) {
  const [moving, setMoving] = useState<number | null>(null);
  const shown = moving ?? value;
  const save = () => {
    if (moving != null && moving !== value) onSave(moving);
    setMoving(null);
  };
  const changed = shown !== limits.default;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-[13px] font-medium">{row.label}</span>
        <span className="flex items-baseline gap-2 text-[13px] tabular-nums">
          {row.shown(shown)}
          {changed && (
            <Button variant="muted-link" size="sm" onClick={() => onSave(null)}>
              Reset to {row.shown(limits.default)}
            </Button>
          )}
        </span>
      </div>
      <input
        type="range"
        aria-label={row.label}
        aria-valuetext={row.shown(shown)}
        min={limits.min}
        max={limits.max}
        step={row.step}
        value={shown}
        onChange={(e) => setMoving(Number(e.target.value))}
        onPointerUp={save}
        onKeyUp={save}
        onBlur={save}
        className="w-full cursor-pointer accent-[var(--color-solar)]"
      />
      <span className="text-xs leading-5 text-pretty text-ink-muted">{row.about}</span>
    </div>
  );
}

type PresetKey = Exclude<EvTimingKey, "battery_full">;
type Preset = Choice<"standard" | "quick" | "steady"> & {
  about: string;
  values: Record<PresetKey, number> | null;
};

/** Ready-made timings, each a whole set (the home battery's full level is left as it is). Standard is the defaults. */
const PRESETS: Preset[] = [
  {
    value: "quick",
    label: "Quick",
    sub: "Catches short sunny spells",
    icon: "bolt",
    about:
      "Follows the sun closely, so the car gets more of it. It starts and stops more often, and wakes the car more.",
    values: { start_after: 60, stop_after: 120, min_switch: 120, amps_every: 20, average: 40, lead: 2700 },
  },
  {
    value: "standard",
    label: "Standard",
    sub: "Balanced",
    icon: "sun",
    about: "Rides out a short cloud without starting and stopping too often.",
    values: null,
  },
  {
    value: "steady",
    label: "Steady",
    sub: "Rides out clouds",
    icon: "cloud",
    about:
      "Changes speed less often. Fewer starts and stops are easier on the car, but it can miss a short sunny spell.",
    values: { start_after: 600, stop_after: 900, min_switch: 1200, amps_every: 180, average: 420, lead: 900 },
  },
];
const PRESET_KEYS: PresetKey[] = ["start_after", "stop_after", "min_switch", "amps_every", "average", "lead"];

/**
 * How the car's solar charging is timed (app.features.tesla.control.TIMING), as a small card: three presets as tiles
 * (Quick; Standard, the defaults; Steady), each setting them all at once, and "Set your own" folding out each wait as a
 * slider, its default a Reset away. The tile lit is the preset the car's timings match; none once they're its own. The
 * home battery's full level is only among the sliders, and only with the home battery first. Shown while it charges
 * from solar.
 */
export function EvTiming({
  v,
  hasBattery,
  brand = "tesla",
  className,
}: {
  v: EvVehicle;
  hasBattery: boolean;
  brand?: EvBrand;
  className?: string;
}) {
  const { data: tesla } = useQuery({ ...teslaQuery, enabled: brand === "tesla" });
  const { data: bluelink } = useQuery({ ...bluelinkQuery, enabled: brand === "bluelink" });
  const status = brand === "tesla" ? tesla : bluelink;
  const { configure } = useEvChange(brand);
  const [custom, setCustom] = useState(false);
  const limits = status?.timing;
  if (!limits || v.control.mode !== "solar") return null;
  const valuesOf = (p: Preset) =>
    p.values ?? (Object.fromEntries(PRESET_KEYS.map((k) => [k, limits[k].default])) as Record<PresetKey, number>);
  const matched = PRESETS.find((p) => PRESET_KEYS.every((k) => v.control[k] === valuesOf(p)[k]));
  const choose = (id: Preset["value"]) => {
    setCustom(false);
    const p = PRESETS.find((x) => x.value === id)!;
    // Standard sets each back to its default (null), so it follows the defaults if they change.
    configure.mutate({
      vin: v.vin,
      ...Object.fromEntries(PRESET_KEYS.map((k) => [k, p.values ? p.values[k] : null])),
    });
  };
  const open = custom || !matched;
  // A Hyundai or Kia's speed can't be changed, so there's no time between changes of it to set.
  const rows = ROWS.filter(
    (r) =>
      (r.key !== "battery_full" || (hasBattery && v.control.first === "battery")) &&
      (r.key !== "amps_every" || brand === "tesla"),
  );
  const full = rows.some((r) => r.key === "battery_full") && v.control.battery_full !== limits.battery_full.default;
  return (
    <SmallCard
      id={`h-tt-${v.vin}`}
      title="Charging timing"
      note={matched ? matched.label : "Your own"}
      className={className}
    >
      <ChoiceTiles
        label="Timing"
        options={PRESETS}
        value={matched?.value ?? null}
        onChange={choose}
        color={COLOR.solar}
      />
      <CardText>
        {matched ? `${matched.about} ` : ""}It starts after {span(v.control.start_after)} of enough sun, stops after{" "}
        {span(v.control.stop_after)} without it, and waits at least {span(v.control.min_switch)} between the two.
        {full && !open && ` Your home battery counts as full at ${v.control.battery_full}%.`}
      </CardText>
      <Button
        variant="muted-link"
        size="sm"
        aria-expanded={open}
        disabled={!matched}
        onClick={() => setCustom(!custom)}
        className="self-start"
      >
        {open ? (matched ? "Hide your own timing" : "Your own timing") : "Set your own"}
      </Button>
      <Collapse open={open} className="flex flex-col gap-4 pt-1">
        {rows.map((r) => (
          <TimingRow
            key={r.key}
            row={r}
            value={v.control[r.key]}
            limits={limits[r.key]}
            onSave={(value) => configure.mutate({ vin: v.vin, [r.key]: value })}
          />
        ))}
      </Collapse>
    </SmallCard>
  );
}
