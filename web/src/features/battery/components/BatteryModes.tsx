import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { previewQuery } from "~/features/battery/api";
import { useBatteryChange } from "~/features/battery/hooks";
import type { BatteryPlan, BatteryView, ControlKind, ControlRequest } from "~/features/battery/types";
import { KIND_COLOR, kw, nextAt, when } from "~/features/battery/utils";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { kWh, money } from "~/features/common/formatting/utils/number";
import { alpha } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { HelpText } from "~/features/common/ui/components/Field";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { useToast } from "~/features/common/ui/components/Toast";
import { cn } from "~/features/common/ui/utils";

type Supported = Extract<BatteryView, { supported: true }>;
type Lasting = "1h" | "3h" | "morning" | "open";

const MORNING = "06:00";

const TILES: { kind: ControlKind; icon: IconName; title: string; sub: string }[] = [
  { kind: "standby", icon: "pause", title: "Standby", sub: "Pause the battery" },
  { kind: "floor", icon: "shield", title: "Reserve", sub: "Keep a minimum charge" },
  { kind: "charge", icon: "bolt", title: "Grid charge", sub: "Fill it from the grid" },
];

const ABOUT: Record<ControlKind, string> = {
  standby: "The battery holds its charge. Your home runs on solar and the grid, and spare solar goes to the grid.",
  floor: "The battery runs your home as usual until it's down to the reserve, then the grid takes over.",
  charge: "The battery charges at a set speed, from the grid when solar can't cover it, then goes back to normal.",
};

const ACTION: Record<ControlKind, string> = {
  standby: "Start standby",
  floor: "Set reserve",
  charge: "Start charging",
};

/** A value made only once its inputs have stopped changing for a moment (a slider being dragged). */
function useSettled<T>(value: T, ms = 350): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}

/**
 * The battery controls: a tile for each (standby, a raised reserve, a charge from the grid); choosing one opens its few
 * settings, with what it will do and cost worked out as you go, and one button to start it. `onPreview` gets that
 * working-out, for the day chart.
 */
export function BatteryModes({
  v,
  soc,
  now,
  onPreview,
}: {
  v: Supported;
  soc: number | null;
  now: number;
  onPreview: (plan: BatteryPlan | null) => void;
}) {
  const active = v.control && !v.control.ending ? v.control : null;
  const [kind, setKind] = useState<ControlKind | null>(null);
  const [lasting, setLasting] = useState<Lasting>("3h");
  const [floor, setFloor] = useState(active?.floor ?? 30);
  const top = Math.round(v.settings?.max_soc ?? 100);
  const [target, setTarget] = useState(top);
  const [lowW, highW] = v.limits.charge_w;
  const speeds = useMemo(() => {
    const steps = [highW / 3, (highW * 2) / 3, highW].map((w) => Math.max(lowW, Math.round(w / 100) * 100));
    return [...new Set(steps)];
  }, [lowW, highW]);
  const [power, setPower] = useState(speeds[speeds.length - 1]);
  const { start } = useBatteryChange();
  const toast = useToast();

  const choose = (k: ControlKind) => {
    setKind(kind === k ? null : k);
    setLasting(k === "charge" ? "open" : "3h");
  };
  const until =
    lasting === "1h"
      ? now + 3600
      : lasting === "3h"
        ? now + 3 * 3600
        : lasting === "morning"
          ? nextAt(MORNING, now)
          : null;
  const minTarget = Math.min(top, Math.max(10, Math.ceil((soc ?? 0) + 1)));
  const body: ControlRequest | null =
    kind == null
      ? null
      : kind === "standby"
        ? { kind, until }
        : kind === "floor"
          ? { kind, until, floor }
          : { kind, until, target: Math.max(target, minTarget), power_w: power };
  // Worked out on the server once the settings stop moving; the times are left out of the key so a ticking clock
  // doesn't ask again (they're rounded to the minute).
  const settledBody = useSettled(body && { ...body, until: body.until && Math.round(body.until / 60) * 60 });
  const { data: plan, isFetching } = useQuery({
    ...previewQuery(v.blocked ? null : settledBody),
    placeholderData: keepPreviousData,
  });
  const shown = kind ? plan : null;
  useEffect(() => onPreview(shown && shown.kind === kind ? shown : null), [shown, kind, onPreview]);

  const go = () => {
    if (!body) return;
    start.mutate(body, {
      onSuccess: () => {
        toast(
          kind === "standby"
            ? "Battery on standby."
            : kind === "floor"
              ? `Reserve set to ${floor}%.`
              : "Charging the battery.",
        );
        setKind(null);
      },
    });
  };

  const lastingOptions: { value: Lasting; label: string }[] = [
    ...(kind === "charge" ? [{ value: "open" as const, label: "Until full" }] : []),
    { value: "1h", label: "1 hour" },
    { value: "3h", label: "3 hours" },
    { value: "morning", label: `Until ${hhmm(nextAt(MORNING, now) ?? now)}` },
    ...(kind !== "charge" ? [{ value: "open" as const, label: "Until I stop" }] : []),
  ];

  return (
    <Card aria-labelledby="h-batmodes" className="gap-5">
      <div className="flex flex-col gap-0.5">
        <h2 id="h-batmodes">Control</h2>
        <span className="text-[13px] text-ink-muted">
          {active ? "Choose another to switch to it." : "Normally the battery runs your home and soaks up spare solar."}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 max-sm:gap-2">
        {TILES.map((t) => {
          const on = kind === t.kind;
          const running = active?.kind === t.kind;
          const color = KIND_COLOR[t.kind];
          return (
            <button
              key={t.kind}
              type="button"
              aria-pressed={on}
              disabled={!!v.blocked}
              onClick={() => choose(t.kind)}
              className={cn(
                "relative flex flex-col items-start gap-3 rounded-2xl border p-4 text-left transition-[border-color,background-color,transform] duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 max-sm:gap-2 max-sm:p-3",
                on ? "border-transparent" : "border-line-subtle bg-canvas/60 hover:border-line light:bg-canvas",
              )}
              style={on ? { background: alpha(color, 0.16), boxShadow: `inset 0 0 0 2px ${color}` } : undefined}
            >
              <span
                className="flex size-10 items-center justify-center rounded-full max-sm:size-8"
                style={{ background: alpha(color, 0.2), color }}
              >
                <Icon name={t.icon} size={18} />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-[15px] font-semibold max-sm:text-sm">{t.title}</span>
                <span className="text-xs text-pretty text-ink-muted max-sm:hidden">{t.sub}</span>
              </span>
              {running && (
                <span
                  className="absolute top-3 right-3 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase"
                  style={{ background: color, color: "var(--color-canvas)" }}
                >
                  On
                </span>
              )}
            </button>
          );
        })}
      </div>

      {kind && (
        <div className="flex animate-pop flex-col gap-5 rounded-2xl bg-canvas/60 p-5 max-sm:p-4 light:bg-canvas">
          <p className="m-0 text-sm text-pretty text-ink-muted">{ABOUT[kind]}</p>

          {kind === "floor" && (
            <Slider
              label="Keep at least"
              value={floor}
              min={v.limits.floor[0]}
              max={v.limits.floor[1]}
              onChange={setFloor}
              color={KIND_COLOR.floor}
              hint={`Usually ${active?.usual_floor ?? v.settings?.min_soc ?? "—"}%. Up to ${v.limits.floor[1]}%.`}
            />
          )}
          {kind === "charge" && (
            <>
              <Slider
                label="Charge to"
                value={Math.max(target, minTarget)}
                min={minTarget}
                max={top}
                onChange={setTarget}
                color={KIND_COLOR.charge}
                hint={soc != null ? `It's at ${Math.round(soc)}% now.` : undefined}
              />
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-semibold">Speed</span>
                <Segmented
                  label="Charging speed"
                  options={speeds.map((w, i) => ({
                    value: String(w),
                    label: `${speeds.length === 3 ? ["Gentle", "Steady", "Fastest"][i] + " · " : ""}${kw(w)}`,
                  }))}
                  value={String(power)}
                  onChange={(w) => setPower(Number(w))}
                  className="self-start max-sm:self-stretch"
                  buttonClassName="max-sm:flex-1 max-sm:justify-center max-sm:px-2"
                />
              </div>
            </>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-semibold">{kind === "charge" ? "Stop" : "For"}</span>
            <Segmented
              label="How long"
              options={lastingOptions}
              value={lasting}
              onChange={setLasting}
              className="self-start max-sm:self-stretch"
              buttonClassName="max-sm:flex-1 max-sm:justify-center max-sm:px-2"
            />
          </div>

          <Outcome kind={kind} plan={shown ?? null} floor={floor} busy={isFetching} now={now} />

          <Button size="lg" disabled={start.isPending} onClick={go} className="w-full justify-center">
            {start.isPending ? "Sending to the inverter…" : ACTION[kind]}
          </Button>
          {start.isError && <HelpText tone="bad">{errorMessage(start.error)}</HelpText>}
        </div>
      )}
    </Card>
  );
}

/** A big slider with its value above it. */
function Slider({
  label,
  value,
  min,
  max,
  onChange,
  color,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  color: string;
  hint?: string;
}) {
  const at = max > min ? ((value - min) / (max - min)) * 100 : 100;
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold">{label}</span>
        <span className="text-[34px] leading-none font-light tracking-[-1px] tabular-nums">
          {value}
          <span className="text-lg text-ink-muted">%</span>
        </span>
      </span>
      <input
        type="range"
        className="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ "--pct": `${at}%`, "--fill": color } as CSSProperties}
      />
      {hint && <span className="text-xs text-ink-muted">{hint}</span>}
    </label>
  );
}

/** What it will do, and cost: worked out from the forecast and your rates. */
function Outcome({
  kind,
  plan,
  floor,
  busy,
  now,
}: {
  kind: ControlKind;
  plan: BatteryPlan | null;
  floor: number;
  busy: boolean;
  now: number;
}) {
  if (!plan)
    return (
      <div className="h-[76px] animate-pulse rounded-xl bg-surface/60" aria-label="Working it out" role="status" />
    );
  const extra = plan.cost - plan.normal_cost;
  const rows: [string, string][] = [];
  if (kind === "charge") {
    rows.push([
      plan.reaches ? "Reaches" : "Gets to",
      `${Math.round(plan.soc_end)}%${plan.ends_at ? ` at ${when(plan.ends_at, now)}` : ""}`,
    ]);
    rows.push(["From the grid", `${kWh(plan.charge_grid_kwh ?? 0)} · about ${money(plan.charge_cost ?? 0)}`]);
  } else if (kind === "floor") {
    const down = plan.points.find(([, soc]) => soc <= floor + 0.1);
    rows.push(["Reaches the reserve", down ? `at ${when(down[0], now)}` : "not before it ends"]);
    rows.push(["From the grid", `${kWh(plan.grid_kwh)} · about ${money(plan.cost)}`]);
  } else {
    rows.push(["Holds at", `${Math.round(plan.soc_end)}%${plan.ends_at ? ` until ${when(plan.ends_at, now)}` : ""}`]);
    rows.push(["From the grid", `${kWh(plan.grid_kwh)} · about ${money(plan.cost)}`]);
  }
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-line-subtle bg-surface p-4 transition-opacity",
        busy && "opacity-60",
      )}
    >
      {rows.map(([k, val]) => (
        <div key={k} className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-ink-muted">{k}</span>
          <span className="font-semibold tabular-nums">{val}</span>
        </div>
      ))}
      <span className="text-xs text-pretty text-ink-muted">
        {Math.abs(extra) < 0.05
          ? "About the same as running as normal."
          : extra > 0
            ? `About ${money(extra)} more than running as normal${plan.ends_at ? "" : " over the next 12 hours"}.`
            : `About ${money(-extra)} less than running as normal.`}{" "}
        From the forecast and your rates.
      </span>
    </div>
  );
}
