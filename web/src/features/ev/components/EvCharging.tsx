import { useEffect, useRef, useState, type ReactNode } from "react";
import { useHasBattery } from "~/features/battery/hooks";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { kW } from "~/features/common/formatting/utils/number";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { Card, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { HelpText } from "~/features/common/ui/components/Field";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { cn } from "~/features/common/ui/utils";
import { EvTiming } from "~/features/ev/components/EvTiming";
import { useEvChange } from "~/features/ev/hooks";
import type { BluelinkCar, EvBrand, EvFirst, EvMode, EvVehicle } from "~/features/ev/types";
import { appName } from "~/features/ev/utils";

const MODES: { mode: EvMode; icon: IconName; title: string; about: string }[] = [
  {
    mode: "off",
    icon: "pause",
    title: "Manual",
    about: "You choose when it charges. The dashboard just keeps an eye on it.",
  },
  {
    mode: "solar",
    icon: "sun",
    title: "Solar only",
    about: "Charges when you've got sun to spare, speeding up and slowing down with it.",
  },
];
const FIRST: { value: EvFirst; icon: IconName; label: string }[] = [
  { value: "battery", icon: "battery", label: "Battery" },
  { value: "shared", icon: "sun", label: "Share" },
  { value: "car", icon: "car", label: "Car" },
];
const MAX_SHORT_BY = 3000;
// The home's flows, in the colours the rest of the dashboard gives them.
const HOME = COLOR.teal;
const HOME_BATTERY = COLOR.battery;
const CAR = COLOR.lilac;
const EXPORT = COLOR.export;

/** One thing about how it charges: a title with its control beside it, what it shows, and a line on what it means. */
function Row({
  title,
  control,
  about,
  children,
}: {
  title: string;
  control?: ReactNode;
  about?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 border-t border-line-subtle pt-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="text-sm font-semibold">{title}</span>
        {control}
      </div>
      {children}
      {about && <Muted>{about}</Muted>}
    </div>
  );
}

function Dot({ color }: { color: string }) {
  return <span className="size-2 flex-none rounded-full" style={{ background: color }} />;
}

/**
 * Where the sun's power is going now, in the order it's shared out: the home first, then the home battery and the car
 * in the order chosen (the battery first when they share), and what's left to the grid. So who gets the sun first is
 * something you can see.
 */
function SunShare({ carW, first }: { carW: number; first: EvFirst }) {
  const p = useSnapshot();
  const hasBattery = useHasBattery();
  if (!p) return null;
  const solar = Math.max(0, p.pv_power ?? 0);
  if (solar < 50) return <Muted>No sun right now. Charging picks up again once the sun's up.</Muted>;
  const home = Math.max(0, (p.load_power ?? 0) - carW);
  const battery = hasBattery ? Math.max(0, -(p.battery_power ?? 0)) : 0;
  const exported = Math.max(0, -(p.grid_power ?? 0));
  const car = { key: "car", label: "Car", w: carW, color: CAR };
  const homeBattery = { key: "battery", label: "Home battery", w: battery, color: HOME_BATTERY };
  const batteryFirst = first !== "car";
  const parts = [
    { key: "home", label: "Home", w: home, color: HOME },
    ...(hasBattery ? (batteryFirst ? [homeBattery, car] : [car, homeBattery]) : [car]),
    { key: "grid", label: "Exported", w: exported, color: EXPORT },
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
        aria-label={`Where your solar is going: ${parts.map((x) => `${x.label} ${kW(x.w)}`).join(", ")}`}
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
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {parts.map((x) => (
          <span key={x.key} className="flex items-center gap-1.5 text-[13px] text-ink-muted tabular-nums">
            <Dot color={x.color} />
            {x.label} <span className="font-medium text-ink">{kW(x.w)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The car's share of the sun: how much is spare for it now, on a scale up to the most it can draw, with the mark it
 * has to reach to start (and, striped, how far short it may run once it's going), and what it's drawing.
 */
function CarMeter({ v, shortBy }: { v: EvVehicle; shortBy: number }) {
  const s = v.state;
  const perAmp = v.volts && v.phases ? v.volts * v.phases : null;
  if (!perAmp || v.min_amps == null || v.max_amps == null || v.min_w == null)
    return <Muted>Link this Tesla to one of your cars (Integrations → Tesla) to see this.</Muted>;
  const top = v.max_amps * perAmp;
  const at = (w: number) => `${Math.max(0, Math.min(100, (w / top) * 100))}%`;
  const spare = v.spare_w != null ? Math.max(0, v.spare_w) : null;
  const draw = s?.charging ? (s.power_kw ?? 0) * 1000 : null;
  const floor = Math.max(0, v.min_w - shortBy);
  const caption =
    draw != null
      ? `Charging at ${kW(draw)}${s?.amps != null ? ` · ${s.amps} A` : ""}`
      : spare == null
        ? "Working out how much is spare…"
        : v.solar_amps
          ? `Enough to charge at ${v.solar_amps} A (${kW(v.solar_amps * perAmp)})`
          : !s?.charging && v.solar_from
            ? `Spare sun expected from ${hhmm(v.solar_from)}`
            : `Needs ${kW(v.min_w - spare)} more to start`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px]">
        <span className="flex items-center gap-1.5">
          <Dot color={draw != null ? CAR : COLOR.solar} />
          <span className="text-ink-muted">{draw != null ? "Charging at" : "Spare for the car"}</span>
          <span className="font-medium tabular-nums">{draw != null ? kW(draw) : spare != null ? kW(spare) : "—"}</span>
        </span>
        <span className="text-ink-muted tabular-nums">{caption}</span>
      </div>
      <div className="relative h-3 rounded-full bg-track">
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
          className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink"
          style={{ left: at(v.min_w) }}
        />
        {draw != null && (
          <span
            className="absolute -inset-y-1 w-1.5 -translate-x-1/2 rounded-full ring-2 ring-surface transition-[left] duration-700 ease-out"
            style={{ left: at(draw), background: CAR }}
          />
        )}
      </div>
      <div className="relative h-4 text-[11px] text-ink-faint tabular-nums">
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap"
          style={{ left: `clamp(3rem, ${at(v.min_w)}, calc(100% - 4.5rem))` }}
        >
          Starts at {kW(v.min_w)} · {v.min_amps} A
        </span>
        <span className="absolute right-0">
          {v.max_amps} A · {kW(top)}
        </span>
      </div>
    </div>
  );
}

/**
 * The car's share of the sun, for a car that charges at one power (a Hyundai or Kia: its current can't be set): how
 * much is spare for it now, on a scale a little past that power, with the mark it has to reach to start (and, striped,
 * how far short it may run once it's going), and what it's drawing.
 */
function FixedMeter({ v, shortBy }: { v: EvVehicle; shortBy: number }) {
  const s = v.state;
  const need = v.min_w;
  if (need == null) return null;
  const spare = v.spare_w != null ? Math.max(0, v.spare_w) : null;
  const draw = s?.charging ? (s.power_kw ?? 0) * 1000 : null;
  const top = Math.max(need * 1.5, (spare ?? 0) * 1.05, draw ?? 0);
  const at = (w: number) => `${Math.max(0, Math.min(100, (w / top) * 100))}%`;
  const floor = Math.max(0, need - shortBy);
  const caption =
    draw != null
      ? `Charging at about ${kW(draw)}`
      : spare == null
        ? "Working out how much is spare…"
        : spare >= need
          ? "Enough to charge"
          : !s?.charging && v.solar_from
            ? `Spare sun expected from ${hhmm(v.solar_from)}`
            : `Needs ${kW(need - spare)} more to start`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[13px]">
        <span className="flex items-center gap-1.5">
          <Dot color={draw != null ? CAR : COLOR.solar} />
          <span className="text-ink-muted">{draw != null ? "Charging at" : "Spare for the car"}</span>
          <span className="font-medium tabular-nums">{draw != null ? kW(draw) : spare != null ? kW(spare) : "—"}</span>
        </span>
        <span className="text-ink-muted tabular-nums">{caption}</span>
      </div>
      <div className="relative h-3 rounded-full bg-track">
        {shortBy > 0 && (
          <span
            className="absolute inset-y-0 transition-[left,width] duration-300"
            style={{
              left: at(floor),
              width: `calc(${at(need)} - ${at(floor)})`,
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
        <span className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: at(need) }} />
      </div>
      <div className="relative h-4 text-[11px] text-ink-faint tabular-nums">
        <span
          className="absolute -translate-x-1/2 whitespace-nowrap"
          style={{ left: `clamp(3rem, ${at(need)}, calc(100% - 3rem))` }}
        >
          Starts at {kW(need)}
        </span>
      </div>
    </div>
  );
}

/** Charging powers a Hyundai or Kia may charge at home (W), as its charger gives them: the car can't be told to
 * charge slower, so it's what's needed spare before it starts. Auto is what the car measured, else a 10 A portable
 * charger's. */
const POWERS: { value: number | "auto"; label: string; about: string }[] = [
  { value: "auto", label: "Auto", about: "" },
  { value: 2400, label: "10 A", about: "a 10 A portable charger (the one that comes with the car)" },
  { value: 3600, label: "15 A", about: "a 15 A portable charger" },
  { value: 7200, label: "32 A", about: "a single-phase wall charger" },
  { value: 11000, label: "3-phase", about: "a three-phase wall charger" },
];

/** A Hyundai or Kia's charging power at home: what it needs spare before it starts, as it can't be slowed. */
function ChargePower({ v, onSave }: { v: BluelinkCar; onSave: (w: number | null) => void }) {
  const chosen = v.control.charge_w ?? "auto";
  const preset = POWERS.find((p) => p.value === chosen);
  const about =
    chosen === "auto"
      ? v.charge_from === "measured"
        ? `It charges at ${kW(v.min_w ?? 0)} at home, as the car measured it.`
        : `It's taken to charge at ${kW(v.min_w ?? 0)}, what a 10 A portable charger gives. Choose your charger if it's another: this car doesn't say.`
      : preset
        ? `${kW(v.min_w ?? 0)}: ${preset.about}.`
        : `${kW(v.min_w ?? 0)}.`;
  return (
    <Row
      title="Your charger"
      control={
        <Segmented
          label="Your charger"
          options={POWERS.map((p) => ({ value: String(p.value), label: p.label }))}
          value={preset ? String(chosen) : "auto"}
          onChange={(value) => onSave(value === "auto" ? null : Number(value))}
          buttonClassName="px-3 py-1.5 text-[13px]"
        />
      }
      about={
        <>
          {about} {v.make}'s cloud can start and stop a charge but can't set how fast it charges, so the car charges at
          whatever its charger gives, and only starts once that much sun is spare.
        </>
      }
    />
  );
}

const AMPS_SETTLE = 700; // ms after the last tap of − or + before the current's sent

/**
 * The charging current by hand: each tap of − or + shows at once, and once the taps stop the last is sent to the car
 * as one command (over Bluetooth each is a conversation of its own, seconds long). A tap while one's on its way is
 * sent after it. With the car asleep it asks first (`asking`): sending it wakes the car.
 */
function useAmps(v: EvVehicle, command: ReturnType<typeof useEvChange>["command"]) {
  const [target, setTarget] = useState<number | null>(null);
  const [asking, setAsking] = useState(false);
  const latest = useRef<number | null>(null);
  const sending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const send = (amps: number) => {
    sending.current = true;
    command.mutate(
      { vin: v.vin, action: "amps", amps },
      {
        onSettled: (_data, error) => {
          sending.current = false;
          if (!error && latest.current != null && latest.current !== amps) return send(latest.current);
          latest.current = null;
          setTarget(null); // what the car took (or, on an error, what it was) shows from the answer
        },
      },
    );
  };
  const amps = target ?? v.state?.amps ?? null;
  const step = (d: number) => {
    const from = latest.current ?? amps; // from the last tap, even before it's shown
    if (from == null) return;
    const next = Math.max(1, Math.min(v.max_amps ?? 32, from + d));
    latest.current = next;
    setTarget(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (v.state?.asleep) setAsking(true);
      else if (!sending.current) send(next);
    }, AMPS_SETTLE);
  };
  const confirm = () => {
    setAsking(false);
    if (latest.current != null) send(latest.current);
  };
  const cancel = () => {
    setAsking(false);
    latest.current = null;
    setTarget(null);
  };
  return { amps, step, asking, confirm, cancel, waiting: target != null && !asking && !command.isPending };
}

/** How much it may borrow through a cloud (W), as a slider: shown on the meter while it moves, saved once it's let
 * go. */
function useShortBy(v: EvVehicle, onSave: (w: number) => void) {
  const [moving, setMoving] = useState<number | null>(null);
  const value = moving ?? v.control.grid_w;
  const save = () => {
    if (moving != null && moving !== v.control.grid_w) onSave(moving);
    setMoving(null);
  };
  const input = (
    <input
      type="range"
      aria-label="Borrow up to"
      aria-valuetext={value ? `Up to ${kW(value)}` : "Nothing: stops straight away"}
      min={0}
      max={MAX_SHORT_BY}
      step={100}
      value={value}
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
 * How the car charges at home: by hand, or from solar only. With solar only, where the sun's going now and the car's
 * share of it, then the two choices (who gets the sun first; how far it may run short through a cloud), each a row
 * with its control beside it. Then starting, stopping and its speed, now.
 */
export function EvCharging({
  v,
  brand = "tesla",
  className,
}: {
  v: EvVehicle | BluelinkCar;
  brand?: EvBrand;
  className?: string;
}) {
  const { configure, command } = useEvChange(brand);
  // A Hyundai or Kia charges at one power: its current can't be set, so it's only started and stopped.
  const fixed = brand === "bluelink" ? (v as BluelinkCar) : null;
  const app = appName(v.make);
  const hasBattery = useHasBattery();
  const c = v.control;
  const s = v.state;
  const set = (body: Parameters<typeof configure.mutate>[0]) => configure.mutate(body);
  const busy = command.isPending || !!fixed?.pending;
  const blocked = !!fixed && !fixed.can_command;
  // While the dashboard follows the sun it sets the speed itself; by hand only when it's manual or paused.
  const auto = c.mode !== "off" && !v.hold;
  const { amps, step, waiting, asking, confirm, cancel } = useAmps(v, command);
  // Starting or stopping an asleep car wakes it: asked first.
  const [askAction, setAskAction] = useState<"start" | "stop" | null>(null);
  const act = (action: "start" | "stop") => (s?.asleep ? setAskAction(action) : command.mutate({ vin: v.vin, action }));
  const perAmp = v.volts && v.phases ? v.volts * v.phases : null;
  const shortBy = useShortBy(v, (w) => set({ vin: v.vin, grid_w: w }));
  const carW = s?.charging ? (s.power_kw ?? 0) * 1000 : 0;
  const ampsText = amps != null ? `${amps} A${perAmp ? ` · ${kW(amps * perAmp)}` : ""}` : "—";
  const mode = MODES.find((m) => m.mode === c.mode) ?? MODES[0];
  const [status, tone] =
    c.mode === "off"
      ? ["Manual", COLOR.inkMuted]
      : v.hold
        ? ["Paused", COLOR.warn]
        : s?.charging
          ? ["Charging on solar", COLOR.solar]
          : v.follow === "ready"
            ? ["Ready to go", COLOR.solar]
            : ["Waiting for sun", COLOR.inkMuted];
  const share = v.share;
  const firstAbout =
    c.first === "battery"
      ? "Your home battery fills up first. The car gets whatever's left after that."
      : c.first === "car"
        ? "The car charges first. Your home battery fills up from whatever's left."
        : !share
          ? "Your home battery gets just enough to be full by sunset, and the car gets the rest."
          : share.battery <= 0
            ? "Your home battery's full, so the car gets all the spare sun."
            : share.battery >= 1
              ? "Your home battery isn't sure to be full by sunset yet, so it comes first for now. The car gets the rest."
              : `Your home battery needs about ${share.need_kwh} kWh more to be full by sunset, so it gets about ${Math.round(share.battery * 100)}% of what it could take. The car gets the rest.`;

  return (
    <Card aria-labelledby={`h-tc-${v.vin}`} className={cn("gap-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TitleBlock id={`h-tc-${v.vin}`} title="Charging" sub="How your car charges at home" />
        <span className="flex items-center gap-1.5 rounded-full border border-chip-line bg-chip px-2.5 py-1 text-xs font-semibold">
          <Dot color={tone} />
          {status}
        </span>
      </div>

      <div className="flex flex-col gap-2.5">
        <Segmented
          label="How your car charges"
          options={MODES.map((m) => ({
            value: m.mode,
            label: (
              <>
                <Icon name={m.icon} size={15} /> {m.title}
              </>
            ),
          }))}
          value={c.mode}
          onChange={(mode) => mode !== c.mode && set({ vin: v.vin, mode })}
          buttonClassName="flex-1 justify-center"
        />
        <Muted>
          {fixed && mode.mode === "solar"
            ? "Charges when there's enough sun to spare for its charger, and stops when there isn't."
            : mode.about}
        </Muted>
      </div>

      {c.mode === "solar" && (
        <>
          <Row
            title="Your sun right now"
            control={
              fixed ? (
                <span className="text-xs text-ink-muted tabular-nums">Starts at {kW(fixed.min_w ?? 0)}</span>
              ) : perAmp && v.phases ? (
                <span className="text-xs text-ink-muted tabular-nums">
                  {v.phases === 1 ? "Single-phase" : `${v.phases}-phase`} · {kW(perAmp)} per amp
                </span>
              ) : undefined
            }
          >
            <SunShare carW={carW} first={c.first} />
            {fixed ? <FixedMeter v={v} shortBy={shortBy.value} /> : <CarMeter v={v} shortBy={shortBy.value} />}
          </Row>
          {fixed && <ChargePower v={fixed} onSave={(w) => set({ vin: v.vin, charge_w: w })} />}
          <Row
            title="Who gets the sun first"
            about={firstAbout}
            control={
              <Segmented
                label="Who gets the sun first"
                options={FIRST.map((f) => ({
                  value: f.value,
                  label: (
                    <>
                      <Icon name={f.icon} size={14} /> {f.label}
                    </>
                  ),
                }))}
                value={c.first}
                onChange={(first) => set({ vin: v.vin, first })}
                buttonClassName="px-3 py-1.5 text-[13px]"
              />
            }
          />
          <Row
            title="Through a cloud"
            control={
              <span className="text-sm font-medium tabular-nums">
                {shortBy.value ? `Borrows up to ${kW(shortBy.value)}` : "Stops straight away"}
              </span>
            }
            about={
              <>
                Once it's charging, it keeps going through a passing cloud by borrowing up to this much from the grid or
                your home battery, rather than stopping straight away. Shown striped on the meter above.
              </>
            }
          >
            {shortBy.input}
          </Row>
          <EvTiming v={v} hasBattery={hasBattery} brand={brand} />
          {s?.at_home === false && s.in_range == null && s.plugged && (
            <Notice tone="warn" className="flex flex-wrap items-center justify-between gap-3">
              <span>The car doesn't seem to be at home, so it won't charge from solar here. Is this your home?</span>
              <Button size="sm" variant="outline" onClick={() => set({ vin: v.vin, home: "here" })}>
                Set as home
              </Button>
            </Notice>
          )}
        </>
      )}
      {configure.isError && <HelpText tone="bad">{errorMessage(configure.error)}</HelpText>}

      <Row
        title="Right now"
        control={
          fixed ? (
            <span className="text-xs text-ink-muted tabular-nums">
              At {kW(fixed.min_w ?? 0)}: its speed can't be set
            </span>
          ) : auto ? (
            <span className="text-xs text-ink-muted">The sun sets the speed</span>
          ) : (
            <div
              className="flex items-center gap-1 rounded-full border border-chip-line bg-canvas p-1"
              role="group"
              aria-label="Charging speed"
            >
              <Button
                size="sm"
                variant="chip"
                aria-label="Charge slower"
                disabled={amps == null || amps <= 1}
                onClick={() => step(-1)}
              >
                −
              </Button>
              <span className="min-w-24 text-center text-sm tabular-nums">{ampsText}</span>
              <Button
                size="sm"
                variant="chip"
                aria-label="Charge faster"
                disabled={amps == null || amps >= (v.max_amps ?? 32)}
                onClick={() => step(1)}
              >
                +
              </Button>
            </div>
          )
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          {s?.charging ? (
            <Button variant="outline" disabled={busy || blocked} onClick={() => act("stop")}>
              <Icon name="pause" size={16} /> Stop charging
            </Button>
          ) : (
            <Button
              disabled={busy || blocked || !s?.plugged || s.charging_state === "Complete"}
              onClick={() => act("start")}
            >
              <Icon name="bolt" size={16} /> Start charging
            </Button>
          )}
          {auto && s?.charging && !fixed && <span className="text-sm text-ink-muted tabular-nums">{ampsText}</span>}
        </div>
        {(asking || askAction) && (
          <Notice tone="warn" className="flex flex-wrap items-center justify-between gap-3">
            <span className="min-w-0 flex-1 text-pretty">
              <b className="font-semibold">
                {asking
                  ? `Set the current to ${amps} A?`
                  : askAction === "start"
                    ? "Start charging?"
                    : "Stop charging?"}
              </b>{" "}
              {v.name ?? "The car"} is asleep, and sending this wakes it.
            </span>
            <span className="flex items-center gap-3">
              <Button
                size="sm"
                disabled={command.isPending}
                onClick={() => {
                  if (asking) confirm();
                  else if (askAction) command.mutate({ vin: v.vin, action: askAction });
                  setAskAction(null);
                }}
              >
                {asking
                  ? `Wake and set ${amps} A`
                  : askAction === "start"
                    ? "Wake and start charging"
                    : "Wake and stop"}
              </Button>
              <Button
                variant="muted-link"
                size="sm"
                onClick={() => {
                  cancel();
                  setAskAction(null);
                }}
              >
                Cancel
              </Button>
            </span>
          </Notice>
        )}
        <HelpText tone={command.isError ? "bad" : undefined}>
          {waiting
            ? `Setting to ${amps} A…`
            : command.isPending
              ? "Sending to your car…"
              : command.isError
                ? errorMessage(command.error)
                : blocked
                  ? "Enter the 4-digit PIN you use in the app (Integrations → Hyundai and Kia) to start and stop this car."
                  : fixed?.pending
                    ? `Sent to the car at ${hhmm(fixed.pending.at)}: waiting for it to say it's done.`
                    : c.mode !== "off"
                      ? fixed
                        ? `Starting or stopping here or in the ${app} app pauses solar charging until you unplug.`
                        : `Starting, stopping or changing the speed here or in the ${app} app pauses solar charging until you unplug.`
                      : ""}
        </HelpText>
      </Row>
    </Card>
  );
}
