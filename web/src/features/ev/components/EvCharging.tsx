import { useState, type ReactNode } from "react";
import { useHasBattery } from "~/features/battery/hooks";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { kW } from "~/features/common/formatting/utils/number";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { HelpText } from "~/features/common/ui/components/Field";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { cn } from "~/features/common/ui/utils";
import { useEvChange } from "~/features/ev/hooks";
import type { EvMode, EvVehicle } from "~/features/ev/types";

const MODES: { mode: EvMode; icon: IconName; title: string; about: string }[] = [
  { mode: "off", icon: "pause", title: "Off", about: "You charge it, as usual. The dashboard only shows the car." },
  {
    mode: "solar",
    icon: "sun",
    title: "Spare solar",
    about: "Starts with enough sun, and follows it an amp at a time.",
  },
];
const MAX_SHORT_BY = 3000;
// The home's flows, in the colours the rest of the dashboard gives them.
const HOME = COLOR.teal;
const HOME_BATTERY = COLOR.battery;
const CAR = COLOR.lilac;
const EXPORT = COLOR.export;

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-line-subtle pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-semibold">{title}</span>
        {aside && <span className="text-xs text-ink-muted tabular-nums">{aside}</span>}
      </div>
      {children}
    </div>
  );
}

/** Off or spare solar, as two tiles: what each does, the chosen one outlined. */
function ModeTiles({ value, disabled, onChange }: { value: EvMode; disabled: boolean; onChange: (m: EvMode) => void }) {
  return (
    <div role="radiogroup" aria-label="How the dashboard charges the car" className="grid grid-cols-2 gap-3">
      {MODES.map((m) => {
        const on = m.mode === value;
        const tint = m.mode === "solar" ? COLOR.solar : COLOR.inkMuted;
        return (
          <button
            key={m.mode}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(m.mode)}
            className={cn(
              "flex flex-col gap-2 rounded-2xl border bg-surface p-4 text-left transition-[border-color,box-shadow] duration-200",
              on ? "border-ink shadow-[0_0_0_1px_var(--color-ink)]" : "border-line-subtle hover:border-line",
            )}
          >
            <span className="flex items-center gap-2.5">
              <span
                className="flex size-8 flex-none items-center justify-center rounded-full"
                style={{ color: tint, background: alpha(tint, 0.14) }}
              >
                <Icon name={m.icon} size={17} />
              </span>
              <span className="text-[15px] font-semibold">{m.title}</span>
            </span>
            <span className="text-[13px] leading-5 text-pretty text-ink-muted">{m.about}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Where the sun's power is going now, in the order it's shared out: the home first, then the home battery and the car
 * in the order chosen, and what's left to the grid. So "home battery first" is something you can see.
 */
function SunShare({ carW, batteryFirst }: { carW: number; batteryFirst: boolean }) {
  const p = useSnapshot();
  const hasBattery = useHasBattery();
  if (!p) return null;
  const solar = Math.max(0, p.pv_power ?? 0);
  if (solar < 50)
    return (
      <p className="m-0 text-[13px] text-ink-muted">
        No sun right now: charging from spare solar waits for the morning.
      </p>
    );
  const home = Math.max(0, (p.load_power ?? 0) - carW);
  const battery = hasBattery ? Math.max(0, -(p.battery_power ?? 0)) : 0;
  const exported = Math.max(0, -(p.grid_power ?? 0));
  const car = { key: "car", label: "Car", w: carW, color: CAR };
  const homeBattery = { key: "battery", label: "Home battery", w: battery, color: HOME_BATTERY };
  const parts = [
    { key: "home", label: "Home", w: home, color: HOME },
    ...(hasBattery ? (batteryFirst ? [homeBattery, car] : [car, homeBattery]) : [car]),
    { key: "grid", label: "To the grid", w: exported, color: EXPORT },
  ];
  const total = Math.max(
    1,
    parts.reduce((a, x) => a + x.w, 0),
  );
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-track"
        role="img"
        aria-label={`Where the sun's going: ${parts.map((x) => `${x.label} ${kW(x.w)}`).join(", ")}`}
      >
        {parts
          .filter((x) => x.w > 0)
          .map((x) => (
            <span
              key={x.key}
              className="h-full transition-[flex-grow] duration-700 ease-out"
              style={{ flexGrow: x.w / total, background: x.color }}
            />
          ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {parts.map((x, i) => (
          <span key={x.key} className="flex items-center gap-1.5 text-xs text-ink-muted tabular-nums">
            {i > 0 && (
              <span aria-hidden className="text-ink-faint">
                →
              </span>
            )}
            <span className="size-2 rounded-full" style={{ background: x.color }} />
            {x.label} <span className="text-ink">{kW(x.w)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The car's share: a scale from nothing to the most it can draw, with each amp marked, the spare solar there is for
 * it now, where it starts (its lowest current), how far short it may run once it's going, and what it's drawing.
 */
function CarShare({ v, shortBy }: { v: EvVehicle; shortBy: number }) {
  const s = v.state;
  const perAmp = v.volts && v.phases ? v.volts * v.phases : null;
  if (!perAmp || v.min_amps == null || v.max_amps == null || v.min_w == null)
    return <p className="m-0 text-[13px] text-ink-muted">Tie the Tesla to a car (Integrations → Tesla) to see this.</p>;
  const lowest = v.min_amps;
  const top = v.max_amps * perAmp;
  const at = (w: number) => `${Math.max(0, Math.min(100, (w / top) * 100))}%`;
  const spare = v.spare_w != null ? Math.max(0, v.spare_w) : null;
  const draw = s?.charging ? (s.power_kw ?? 0) * 1000 : null;
  const floor = Math.max(0, v.min_w - shortBy);
  const amps = Array.from({ length: Math.max(0, v.max_amps - lowest + 1) }, (_, i) => lowest + i);
  const caption =
    spare == null
      ? "Working out the spare solar…"
      : v.solar_amps
        ? `Enough for ${v.solar_amps} A (${kW(v.solar_amps * perAmp)})`
        : `${kW(v.min_w - spare)} short of starting`;
  return (
    <div className="flex flex-col gap-2">
      <div className="relative pt-5 pb-6">
        <span
          className="absolute top-0 -translate-x-1/2 text-[11px] whitespace-nowrap text-ink-muted tabular-nums"
          style={{ left: `clamp(2.75rem, ${at(v.min_w)}, calc(100% - 2.75rem))` }}
        >
          Starts at {kW(v.min_w)}
        </span>
        <div className="relative h-3 rounded-full bg-track">
          {/* How far short it may run once it's going: striped, below where it starts. */}
          {shortBy > 0 && (
            <span
              className="absolute inset-y-0 transition-[left,width] duration-300"
              style={{
                left: at(floor),
                width: `calc(${at(v.min_w)} - ${at(floor)})`,
                background: `repeating-linear-gradient(135deg, ${alpha(COLOR.solar, 0.5)} 0 3px, transparent 3px 6px)`,
              }}
            />
          )}
          {spare != null && (
            <span
              className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
              style={{ width: at(spare), background: COLOR.solar }}
            />
          )}
          <span
            className="absolute -inset-y-1.5 w-0.5 -translate-x-1/2 rounded-full bg-ink"
            style={{ left: at(v.min_w) }}
          />
          {draw != null && (
            <span
              className="absolute -inset-y-1 w-1.5 -translate-x-1/2 rounded-full ring-2 ring-surface"
              style={{ left: at(draw), background: CAR }}
            />
          )}
        </div>
        {/* Each amp along the bottom; the lowest and highest named. */}
        {amps.map((a) => (
          <span
            key={a}
            aria-hidden
            className="absolute bottom-[18px] h-1.5 w-px -translate-x-1/2 bg-ink-faint"
            style={{ left: at(a * perAmp) }}
          />
        ))}
        <span className="absolute bottom-0 left-0 text-[11px] text-ink-faint tabular-nums">0</span>
        <span
          className="absolute bottom-0 -translate-x-1/2 text-[11px] text-ink-faint tabular-nums"
          style={{ left: at(v.min_w) }}
        >
          {lowest} A
        </span>
        <span className="absolute right-0 bottom-0 text-[11px] text-ink-faint tabular-nums">
          {v.max_amps} A · {kW(top)}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px]">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: COLOR.solar }} />
          <span className="text-ink-muted">Spare for the car</span>
          <span className="tabular-nums">{spare != null ? kW(spare) : "—"}</span>
        </span>
        <span className="text-ink-muted tabular-nums">{caption}</span>
      </div>
      {draw != null && (
        <span className="flex items-center gap-1.5 text-[13px]">
          <span className="size-2 rounded-full" style={{ background: CAR }} />
          <span className="text-ink-muted">Drawing</span>
          <span className="tabular-nums">
            {kW(draw)}
            {s?.amps != null ? ` at ${s.amps} A` : ""}
          </span>
        </span>
      )}
    </div>
  );
}

/** How far short it may run (W), as a slider: shown on the scale while it moves, saved once it's let go. */
function useShortBy(v: EvVehicle, onSave: (w: number) => void, disabled: boolean) {
  const [moving, setMoving] = useState<number | null>(null);
  const value = moving ?? v.control.grid_w;
  const save = () => {
    if (moving != null && moving !== v.control.grid_w) onSave(moving);
    setMoving(null);
  };
  const input = (
    <input
      type="range"
      aria-label="Keep charging when short by"
      aria-valuetext={value ? `Up to ${kW(value)} short` : "Not at all"}
      min={0}
      max={MAX_SHORT_BY}
      step={100}
      value={value}
      disabled={disabled}
      onChange={(e) => setMoving(Number(e.target.value))}
      onPointerUp={save}
      onKeyUp={save}
      onBlur={save}
      className="w-full cursor-pointer accent-[var(--color-solar)]"
    />
  );
  return { value, input };
}

/**
 * How the dashboard charges the car: off, or from spare solar. With spare solar, where the sun's going now, the car's
 * share of it on a scale of what it can draw, who gets the sun first, and how far short it may run through a cloud.
 * Then starting, stopping and the current, now.
 */
export function EvCharging({ v, className }: { v: EvVehicle; className?: string }) {
  const { configure, command } = useEvChange();
  const c = v.control;
  const s = v.state;
  const set = (body: Parameters<typeof configure.mutate>[0]) => configure.mutate(body);
  const busy = command.isPending;
  // While the dashboard follows the sun it sets the current itself; by hand only when it's off or on hold.
  const auto = c.mode !== "off" && !v.hold;
  const amps = s?.amps ?? null;
  const perAmp = v.volts && v.phases ? v.volts * v.phases : null;
  const step = (d: number) =>
    amps != null &&
    command.mutate({ vin: v.vin, action: "amps", amps: Math.max(1, Math.min(v.max_amps ?? 32, amps + d)) });
  const shortBy = useShortBy(v, (w) => set({ vin: v.vin, grid_w: w }), configure.isPending);
  const carW = s?.charging ? (s.power_kw ?? 0) * 1000 : 0;
  const ampsText = amps != null ? `${amps} A${perAmp ? ` · ${kW(amps * perAmp)}` : ""}` : "—";
  const [status, tone] =
    c.mode === "off"
      ? ["You're in charge", COLOR.inkMuted]
      : v.hold
        ? ["On hold", COLOR.warn]
        : s?.charging
          ? ["Following the sun", COLOR.solar]
          : v.follow === "ready"
            ? ["Ready for the sun", COLOR.solar]
            : ["Waiting for the sun", COLOR.inkMuted];

  return (
    <Card aria-labelledby={`h-tc-${v.vin}`} className={cn("gap-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TitleBlock id={`h-tc-${v.vin}`} title="Charging" sub="How the dashboard charges the car at home" />
        <span className="flex items-center gap-1.5 rounded-full border border-chip-line bg-chip px-2.5 py-1 text-xs font-semibold">
          <span className="size-2 rounded-full" style={{ background: tone }} />
          {status}
        </span>
      </div>
      <ModeTiles value={c.mode} disabled={configure.isPending} onChange={(mode) => set({ vin: v.vin, mode })} />

      {c.mode === "solar" && (
        <>
          <Section title="Where the sun's going now">
            <SunShare carW={carW} batteryFirst={c.battery_first} />
          </Section>
          <Section
            title="The car's share"
            aside={
              !s?.charging && v.solar_from
                ? `Spare solar expected from ${hhmm(v.solar_from)}`
                : perAmp && v.phases
                  ? `${v.phases === 1 ? "One phase" : `${v.phases} phases`} · ${kW(perAmp)} an amp`
                  : undefined
            }
          >
            <CarShare v={v} shortBy={shortBy.value} />
          </Section>
          <Section title="Who gets the sun first">
            <Segmented
              label="Who gets the sun first"
              options={[
                {
                  value: "battery",
                  label: (
                    <>
                      <Icon name="battery" size={15} /> Home battery
                    </>
                  ),
                },
                {
                  value: "car",
                  label: (
                    <>
                      <Icon name="car" size={15} /> Car
                    </>
                  ),
                },
              ]}
              value={c.battery_first ? "battery" : "car"}
              onChange={(who) => set({ vin: v.vin, battery_first: who === "battery" })}
              buttonClassName="flex-1 justify-center"
            />
            <span className="text-[13px] leading-5 text-pretty text-ink-muted">
              {c.battery_first
                ? "The car gets what's left once the home battery is charging at its full rate, or is full."
                : "The car gets spare solar before the home battery does."}
            </span>
          </Section>
          <Section
            title="Ride through clouds"
            aside={shortBy.value ? `Up to ${kW(shortBy.value)} short` : "Stops as soon as it's short"}
          >
            {shortBy.input}
            <span className="text-[13px] leading-5 text-pretty text-ink-muted">
              Once it's charging, it keeps going while it's this far short, drawing the difference from the grid or the
              home battery{v.min_w ? `; it needs ${kW(v.min_w)} at its lowest current` : ""}. Striped on the scale
              above.
            </span>
          </Section>
          {s?.at_home === false && s.in_range == null && s.plugged && (
            <Notice tone="warn" className="flex flex-wrap items-center justify-between gap-3">
              <span>Charging here isn't controlled: the car isn't at home. Is this home?</span>
              <Button size="sm" variant="outline" onClick={() => set({ vin: v.vin, home: "here" })}>
                This is home
              </Button>
            </Notice>
          )}
        </>
      )}
      {configure.isError && <HelpText tone="bad">{errorMessage(configure.error)}</HelpText>}

      <Section title="Now" aside={auto ? "The current follows the sun" : undefined}>
        <div className="flex flex-wrap items-center gap-3">
          {s?.charging ? (
            <Button variant="outline" disabled={busy} onClick={() => command.mutate({ vin: v.vin, action: "stop" })}>
              <Icon name="pause" size={16} /> Stop charging
            </Button>
          ) : (
            <Button
              disabled={busy || !s?.plugged || s.charging_state === "Complete"}
              onClick={() => command.mutate({ vin: v.vin, action: "start" })}
            >
              <Icon name="bolt" size={16} /> Charge now
            </Button>
          )}
          {auto ? (
            s?.charging && <span className="text-sm text-ink-muted tabular-nums">{ampsText}</span>
          ) : (
            <div
              className="flex items-center gap-1 rounded-full border border-chip-line bg-canvas p-1"
              role="group"
              aria-label="Charging current"
            >
              <Button
                size="sm"
                variant="chip"
                aria-label="Less current"
                disabled={busy || amps == null || amps <= 1}
                onClick={() => step(-1)}
              >
                −
              </Button>
              <span className="min-w-24 text-center text-sm tabular-nums">{ampsText}</span>
              <Button
                size="sm"
                variant="chip"
                aria-label="More current"
                disabled={busy || amps == null || amps >= (v.max_amps ?? 32)}
                onClick={() => step(1)}
              >
                +
              </Button>
            </div>
          )}
        </div>
        <HelpText tone={command.isError ? "bad" : undefined}>
          {command.isPending
            ? "Sending to the car…"
            : command.isError
              ? errorMessage(command.error)
              : c.mode !== "off"
                ? "Starting, stopping or changing the current here or in the car's app puts it on hold until it's unplugged."
                : ""}
        </HelpText>
      </Section>
    </Card>
  );
}
