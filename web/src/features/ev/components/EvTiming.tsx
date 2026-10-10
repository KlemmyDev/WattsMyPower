import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { duration } from "~/features/common/formatting/utils/date";
import { Button } from "~/features/common/ui/components/Button";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { bluelinkQuery, teslaQuery } from "~/features/ev/api";
import { useEvChange } from "~/features/ev/hooks";
import type { EvBrand, EvTimingKey, EvVehicle } from "~/features/ev/types";

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
    about: "How long it keeps going once there isn't enough sun, even with what it may borrow, before it stops.",
    step: 30,
    shown: (s) => (s ? span(s) : "Straight away"),
  },
  {
    key: "min_switch",
    label: "Least time between starting and stopping",
    about: "Each start or stop wakes the car and clicks its charge port over, so not too often.",
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
      "How long before spare sun is expected the car is checked each minute (and, over Bluetooth, woken), so it starts without delay.",
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
type Preset = {
  id: "standard" | "quick" | "steady";
  label: string;
  about: string;
  values: Record<PresetKey, number> | null;
};

/** Ready-made timings, each a whole set (the home battery's full level is left as it is). Standard is the defaults. */
const PRESETS: Preset[] = [
  {
    id: "standard",
    label: "Standard",
    about: "A balance: it rides out a short cloud without starting and stopping too often.",
    values: null,
  },
  {
    id: "quick",
    label: "Quick",
    about:
      "Follows the sun closely and catches short sunny spells, so the car gets more of it. It starts and stops more often, and wakes the car more.",
    values: { start_after: 60, stop_after: 120, min_switch: 120, amps_every: 20, average: 40, lead: 2700 },
  },
  {
    id: "steady",
    label: "Steady",
    about:
      "Rides out clouds and changes little: fewer starts and stops, easier on the car. It may miss a short sunny spell.",
    values: { start_after: 600, stop_after: 900, min_switch: 1200, amps_every: 180, average: 420, lead: 900 },
  },
];
const PRESET_KEYS: PresetKey[] = ["start_after", "stop_after", "min_switch", "amps_every", "average", "lead"];

/**
 * How the car's solar charging is timed (app.features.tesla.control.TIMING): a preset (Standard, the defaults; Quick;
 * Steady), each setting them all at once, or Custom, each wait as a slider, its default a Reset away. The preset shown
 * is the one the car's timings match; Custom when none does, or once it's chosen. The home battery's full level only
 * in Custom, and only with the home battery first.
 */
export function EvTiming({ v, hasBattery, brand = "tesla" }: { v: EvVehicle; hasBattery: boolean; brand?: EvBrand }) {
  const { data: tesla } = useQuery({ ...teslaQuery, enabled: brand === "tesla" });
  const { data: bluelink } = useQuery({ ...bluelinkQuery, enabled: brand === "bluelink" });
  const status = brand === "tesla" ? tesla : bluelink;
  const { configure } = useEvChange(brand);
  const [custom, setCustom] = useState(false);
  const limits = status?.timing;
  if (!limits) return null;
  const valuesOf = (p: Preset) =>
    p.values ?? (Object.fromEntries(PRESET_KEYS.map((k) => [k, limits[k].default])) as Record<PresetKey, number>);
  const matched = PRESETS.find((p) => PRESET_KEYS.every((k) => v.control[k] === valuesOf(p)[k]));
  const chosen = custom || !matched ? "custom" : matched.id;
  const choose = (id: Preset["id"] | "custom") => {
    if (id === "custom") return setCustom(true);
    setCustom(false);
    const p = PRESETS.find((x) => x.id === id)!;
    // Standard sets each back to its default (null), so it follows the defaults if they change.
    configure.mutate({
      vin: v.vin,
      ...Object.fromEntries(PRESET_KEYS.map((k) => [k, p.values ? p.values[k] : null])),
    });
  };
  // A Hyundai or Kia's speed can't be changed, so there's no time between changes of it to set.
  const rows = ROWS.filter(
    (r) =>
      (r.key !== "battery_full" || (hasBattery && v.control.first === "battery")) &&
      (r.key !== "amps_every" || brand === "tesla"),
  );
  const full = rows.some((r) => r.key === "battery_full") && v.control.battery_full !== limits.battery_full.default;
  return (
    <div className="flex flex-col gap-3 border-t border-line-subtle pt-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="text-sm font-semibold">Timing</span>
        <Segmented
          label="Timing"
          value={chosen}
          onChange={choose}
          options={[
            ...PRESETS.map((p) => ({ value: p.id, label: p.label })),
            { value: "custom" as const, label: "Custom" },
          ]}
          className="max-sm:w-full"
          buttonClassName="px-3 py-[7px] text-[13px] max-sm:flex-1 max-sm:justify-center"
        />
      </div>
      <span className="text-[13px] leading-5 text-pretty text-ink-muted">
        {chosen === "custom" ? "Your own timing, set below." : PRESETS.find((p) => p.id === chosen)!.about} It starts
        after {span(v.control.start_after)} of enough sun, stops after {span(v.control.stop_after)} without it, and
        waits at least {span(v.control.min_switch)} between the two.
        {full && chosen !== "custom" && ` Your home battery counts as full at ${v.control.battery_full}%.`}
      </span>
      {chosen === "custom" && (
        <div className="flex flex-col gap-4">
          {rows.map((r) => (
            <TimingRow
              key={r.key}
              row={r}
              value={v.control[r.key]}
              limits={limits[r.key]}
              onSave={(value) => configure.mutate({ vin: v.vin, [r.key]: value })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
