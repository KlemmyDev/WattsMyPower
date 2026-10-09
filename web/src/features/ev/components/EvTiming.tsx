import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { duration } from "~/features/common/formatting/utils/date";
import { Button } from "~/features/common/ui/components/Button";
import { teslaQuery } from "~/features/ev/api";
import { useEvChange } from "~/features/ev/hooks";
import type { EvTimingKey, EvVehicle } from "~/features/ev/types";

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

/**
 * How the car's solar charging is timed (app.features.tesla.control.TIMING): each wait as a slider, its default a
 * Reset away. Folded away until asked for; says how many have been changed. The home battery's full level only
 * with the home battery first.
 */
export function EvTiming({ v, hasBattery }: { v: EvVehicle; hasBattery: boolean }) {
  const { data: status } = useQuery(teslaQuery);
  const { configure } = useEvChange();
  const [open, setOpen] = useState(false);
  const limits = status?.timing;
  if (!limits) return null;
  const rows = ROWS.filter((r) => r.key !== "battery_full" || (hasBattery && v.control.first === "battery"));
  const changed = rows.filter((r) => v.control[r.key] !== limits[r.key].default).length;
  return (
    <div className="flex flex-col gap-3 border-t border-line-subtle pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-semibold">Timing</span>
        <span className="flex items-baseline gap-3 text-xs text-ink-muted tabular-nums">
          {changed ? `${changed} changed` : "As standard"}
          <Button variant="muted-link" size="sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide" : "Adjust"}
          </Button>
        </span>
      </div>
      {open ? (
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
      ) : (
        <span className="text-[13px] leading-5 text-pretty text-ink-muted">
          Starts after {span(v.control.start_after)} of enough sun, stops after {span(v.control.stop_after)} without it,
          and waits at least {span(v.control.min_switch)} between the two.
        </span>
      )}
    </div>
  );
}
