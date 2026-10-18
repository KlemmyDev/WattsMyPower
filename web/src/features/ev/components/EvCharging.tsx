import { useEffect, useRef, useState, type ReactNode } from "react";
import { useHasBattery } from "~/features/battery/hooks";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { kW } from "~/features/common/formatting/utils/number";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText } from "~/features/common/ui/components/Field";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { CardText, ChoiceTiles, SmallCard, type Choice } from "~/features/common/ui/components/SmallCard";
import { cn } from "~/features/common/ui/utils";
import { SolarOutlook } from "~/features/ev/components/EvOutlook";
import { useEvChange, useSpareNow } from "~/features/ev/hooks";
import type { BluelinkCar, EvBrand, EvFirst, EvMode, EvVehicle } from "~/features/ev/types";
import { appName } from "~/features/ev/utils";

const MODES: Choice<EvMode>[] = [
  { value: "off", icon: "pause", label: "Manual", sub: "You choose when it charges", color: COLOR.inkMuted },
  { value: "solar", icon: "sun", label: "Solar only", sub: "Speeds up and slows with your sun", color: COLOR.solar },
];
const FIRST: Choice<EvFirst>[] = [
  { value: "battery", icon: "battery", label: "Battery", sub: "Fills first", color: COLOR.battery },
  { value: "shared", icon: "sun", label: "Share", sub: "Full by sunset", color: COLOR.solar },
  { value: "car", icon: "car", label: "Car", sub: "Charges first", color: COLOR.danger },
];
const FIRST_WORDS: Record<EvFirst, string> = { battery: "Battery first", shared: "Shared", car: "Car first" };
const MAX_SHORT_BY = 3000;
// The home's flows, in the colours the rest of the dashboard gives them.
const HOME = COLOR.teal;
const HOME_BATTERY = COLOR.battery;
const CAR = COLOR.lilac;
const EXPORT = COLOR.export;

/** One setting in a card: its name with its control beside it, and a line on what it means. */
function Setting({ title, control, children }: { title: string; control: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-line-subtle pt-3.5 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="text-sm font-medium">{title}</span>
        {control}
      </div>
      {children}
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
  if (solar < 50) return <CardText>No sun right now. Charging picks up again once the sun's up.</CardText>;
  const home = Math.max(0, (p.load_power ?? 0) - carW);
  const battery = hasBattery ? Math.max(0, -(p.battery_power ?? 0)) : 0;
  const exported = Math.max(0, -(p.grid_power ?? 0));
  const car = { key: "car", label: "Car", w: carW, color: CAR };
  const homeBattery = { key: "battery", label: "Battery", w: battery, color: HOME_BATTERY };
  const batteryFirst = first !== "car";
  const parts = [
    { key: "home", label: "Home", w: home, color: HOME },
    ...(hasBattery ? (batteryFirst ? [homeBattery, car] : [car, homeBattery]) : [car]),
    { key: "grid", label: "Sent to the grid", w: exported, color: EXPORT },
  ];
  const total = Math.max(
    1,
    parts.reduce((a, x) => a + x.w, 0),
  );
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-track"
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
 * The car's share of the sun, a chunk for each amp: a first, longer block up to the lowest current it charges at (what
 * has to be spare before it starts at all, striped where it may run short through a cloud), then one chunk for each
 * amp above that, up to the most it can draw. The spare sun now (`live`, from the latest reading) fills them from the
 * left, so how near it is to the next amp shows as the chunk filling; beside it, the average over the last few
 * minutes that the dashboard goes by. A small mark over the chunks, and a line under those it's using, say the
 * current it's charging at.
 */
function AmpMeter({ v, live }: { v: EvVehicle; live: number | null }) {
  const s = v.state;
  const shortBy = v.control.grid_w;
  const perAmp = v.volts && v.phases ? v.volts * v.phases : null;
  if (!perAmp || v.min_amps == null || v.max_amps == null || v.min_w == null)
    return <CardText>Link this Tesla to one of your cars (Integrations → Tesla) to see this.</CardText>;
  const lo = v.min_amps;
  const n = Math.max(0, v.max_amps - lo);
  const start = v.min_w;
  const average = v.spare_w != null ? Math.max(0, v.spare_w) : null;
  const spare = live != null ? Math.max(0, live) : average;
  const amps = s?.charging && s.amps != null ? Math.max(lo, Math.min(v.max_amps, s.amps)) : null;
  // How full each is, from the spare sun: the start block to the lowest current, then each amp's worth past it.
  const filled = (from: number, to: number) =>
    spare == null ? 0 : Math.max(0, Math.min(1, (spare - from) / (to - from)));
  const cells = [
    { amps: lo, fill: filled(0, start) },
    ...Array.from({ length: n }, (_, k) => ({
      amps: lo + k + 1,
      fill: filled(start + k * perAmp, start + (k + 1) * perAmp),
    })),
  ];
  const columns = `minmax(0, ${Math.max(3, Math.round(n / 3))}fr) repeat(${n}, minmax(0, 1fr))`;
  const floor = Math.max(0, start - shortBy);
  const label = (a: number, i: number) =>
    i === 0
      ? `Starts at ${a} A`
      : i === cells.length - 1
        ? `${a} A`
        : a % 5 === 0 && cells.length - 1 - i > 2 // clear of the last one's label
          ? String(a)
          : "";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex items-baseline gap-1 tabular-nums">
          <span className="text-[28px] leading-8 font-light tracking-[-0.6px]">
            {spare != null ? kW(spare).split(" ")[0] : "—"}
          </span>
          <span className="text-sm text-ink-faint">kW spare now</span>
        </span>
        <span className="text-xs text-ink-faint tabular-nums" title="What starting, stopping and the speed go by">
          {average != null ? `${clockWords(v.control.average)} average ${kW(average)}` : "Averaging…"}
        </span>
      </div>
      <div
        role="img"
        aria-label={`Spare solar ${spare != null ? kW(spare) : "not known yet"}: ${
          v.solar_amps ? `enough for ${v.solar_amps} A` : `${kW(start)} needed to start at ${lo} A`
        }, up to ${v.max_amps} A${amps != null ? `. Charging at ${amps} A` : ""}.`}
        className="flex flex-col gap-1"
      >
        {/* The current it's charging at: a small mark over its chunk. */}
        <div className="grid h-4 gap-[3px]" style={{ gridTemplateColumns: columns }} aria-hidden>
          {cells.map((c, i) => (
            <span key={c.amps} className="relative">
              {c.amps === amps && (
                <span
                  className={cn(
                    "absolute right-0 bottom-0 flex flex-col items-center text-[11px] leading-none font-medium whitespace-nowrap tabular-nums",
                    i > 0 && "translate-x-1/2",
                  )}
                  style={{ color: CAR }}
                >
                  {amps} A
                  <span className="mt-0.5 size-0 border-x-[4px] border-t-[4px] border-x-transparent border-t-current" />
                </span>
              )}
            </span>
          ))}
        </div>
        <div className="grid gap-[3px]" style={{ gridTemplateColumns: columns }} aria-hidden>
          {cells.map((c, i) => (
            <span
              key={c.amps}
              className="relative h-3 overflow-hidden rounded-[4px] bg-track transition-shadow duration-500"
              style={amps != null && c.amps <= amps ? { boxShadow: `inset 0 -2px 0 ${CAR}` } : undefined}
            >
              {i === 0 && shortBy > 0 && (
                <span
                  className="absolute inset-y-0 right-0 transition-[left] duration-300"
                  style={{
                    left: `${(floor / start) * 100}%`,
                    background: `repeating-linear-gradient(135deg, ${alpha(COLOR.solar, 0.5)} 0 3px, transparent 3px 6px)`,
                  }}
                />
              )}
              <span
                className="absolute inset-y-0 left-0 transition-[width] duration-700 ease-out"
                style={{ width: `${c.fill * 100}%`, background: alpha(COLOR.solar, c.fill >= 1 ? 1 : 0.7) }}
              />
            </span>
          ))}
        </div>
        <div
          className="grid h-4 gap-[3px] text-[11px] text-ink-faint tabular-nums"
          style={{ gridTemplateColumns: columns }}
        >
          {cells.map((c, i) => (
            <span
              key={c.amps}
              className={cn("relative whitespace-nowrap", i === 0 ? "text-left" : "text-right")}
              aria-hidden
            >
              {i === 0 ? (
                label(c.amps, i)
              ) : label(c.amps, i) ? (
                <span className={cn("absolute right-0", i < cells.length - 1 && "translate-x-1/2")}>
                  {label(c.amps, i)}
                </span>
              ) : null}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The car's share of the sun, for a car that charges at one power (a Hyundai or Kia: its current can't be set): how
 * much is spare for it now, on a scale a little past that power, with the mark it has to reach to start (and, striped,
 * how far short it may run once it's going), and what it's drawing.
 */
function FixedMeter({ v }: { v: EvVehicle }) {
  const s = v.state;
  const need = v.min_w;
  const shortBy = v.control.grid_w;
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
            ? `Spare solar expected from ${hhmm(v.solar_from)}`
            : `Needs ${kW(need - spare)} more to start`;
  const shown = draw ?? spare;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="flex items-baseline gap-1 tabular-nums">
          <span className="text-[28px] leading-8 font-light tracking-[-0.6px]">
            {shown != null ? kW(shown).split(" ")[0] : "—"}
          </span>
          <span className="text-sm text-ink-faint">{draw != null ? "kW charging" : "kW spare now"}</span>
        </span>
        <span className="text-xs text-ink-faint tabular-nums">{caption}</span>
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
        ? `It charges at ${kW(v.min_w ?? 0)} at home, measured by the car.`
        : `Assumed to charge at ${kW(v.min_w ?? 0)}, what a 10 A portable charger gives. This car doesn't report it, so pick your charger if it's different.`
      : preset
        ? `${kW(v.min_w ?? 0)} with ${preset.about}.`
        : `${kW(v.min_w ?? 0)}.`;
  return (
    <Setting
      title="Your charger"
      control={
        <Segmented
          label="Your charger"
          options={POWERS.map((p) => ({ value: String(p.value), label: p.label }))}
          value={preset ? String(chosen) : "auto"}
          onChange={(value) => onSave(value === "auto" ? null : Number(value))}
          className="max-sm:w-full"
          buttonClassName="px-2.5 py-1.5 text-[13px] max-sm:flex-1 max-sm:justify-center"
        />
      }
    >
      <CardText>
        {about} {v.make}'s cloud can start and stop a charge but can't set its speed, so it only starts once that much
        sun is spare.
      </CardText>
    </Setting>
  );
}

/** A wait in words, for the average it goes by: "2½ min", "45 s", "5 min". */
function clockWords(secs: number): string {
  if (secs < 60) return `${secs} s`;
  const m = secs / 60;
  return Number.isInteger(m) ? `${m} min` : m % 1 === 0.5 ? `${Math.floor(m)}½ min` : `${Math.round(m)} min`;
}

const AMPS_SETTLE = 700; // ms after the last tap of − or + before the current's sent
const MOST_AMPS = 48; // the most a car may be held to (app.features.tesla.control.MAX_AMPS)

/** − and + either side of what they set. */
function Stepper({
  label,
  text,
  less,
  more,
  onStep,
}: {
  label: string;
  text: string;
  less: boolean;
  more: boolean;
  onStep: (d: number) => void;
}) {
  return (
    <div
      className="flex items-center gap-1 rounded-full border border-chip-line bg-canvas p-1"
      role="group"
      aria-label={label}
    >
      <Button size="sm" variant="chip" aria-label="Less" disabled={!less} onClick={() => onStep(-1)}>
        −
      </Button>
      <span className="min-w-24 text-center text-sm tabular-nums">{text}</span>
      <Button size="sm" variant="chip" aria-label="More" disabled={!more} onClick={() => onStep(1)}>
        +
      </Button>
    </div>
  );
}

/**
 * The most a Tesla may draw at home, by − and +: the socket's or circuit's limit ("20 A"), or none, the car's own (what
 * it says it can take with the charger it's on). Past the car's own is none. Each tap shows at once; once they stop
 * it's saved, and shown as being until the answer has it.
 */
function MostAmps({ v, configure }: { v: EvVehicle; configure: ReturnType<typeof useEvChange>["configure"] }) {
  const own = v.car_max_amps ?? v.max_amps ?? 32;
  const [moving, setMoving] = useState<number | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const value = moving !== undefined ? moving : (v.control.max_amps ?? null);
  const shown = value ?? own;
  const perAmp = v.volts && v.phases ? v.volts * v.phases : null;
  const step = (d: number) => {
    const next = Math.max(1, Math.min(MOST_AMPS, shown + d));
    const to = next > own ? null : next;
    setMoving(to);
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => configure.mutate({ vin: v.vin, max_amps: to }, { onSettled: () => setMoving(undefined) }),
      AMPS_SETTLE,
    );
  };
  return (
    <Setting
      title="Most it can draw"
      control={
        <Stepper
          label="Most it can draw"
          text={value == null ? "No limit" : `${value} A${perAmp ? ` · ${kW(value * perAmp)}` : ""}`}
          less={shown > 1}
          more={value != null}
          onStep={step}
        />
      }
    >
      <CardText>
        {value == null
          ? `Up to what the car says it can take on this charger, ${own} A. If your socket or circuit can't take that, set its limit here.`
          : `Never more than ${value} A, from solar or by hand. The car says it could take ${own} A.`}
      </CardText>
    </Setting>
  );
}

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

/** How much it may borrow through a cloud (W), as a slider: shown as it moves, saved once it's let go. */
function ShortBy({ v, onSave }: { v: EvVehicle; onSave: (w: number) => void }) {
  const [moving, setMoving] = useState<number | null>(null);
  const value = moving ?? v.control.grid_w;
  const save = () => {
    if (moving != null && moving !== v.control.grid_w) onSave(moving);
    setMoving(null);
  };
  return (
    <Setting
      title="Through a cloud"
      control={
        <span className="text-sm tabular-nums">{value ? `Borrows up to ${kW(value)}` : "Stops straight away"}</span>
      }
    >
      <input
        type="range"
        aria-label="Borrow up to"
        aria-valuetext={value ? `Up to ${kW(value)}` : "Nothing, stops straight away"}
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
      <CardText>
        Once it's charging, it keeps going through a passing cloud by borrowing up to this much from the grid or your
        home battery.
      </CardText>
    </Setting>
  );
}

/** What it's doing about charging, in a few words and a colour, for the Charging card's corner. */
function statusOf(v: EvVehicle): [string, string] {
  const c = v.control;
  if (c.mode === "off") return [v.state?.charging ? "Charging" : "Manual", COLOR.inkMuted];
  if (v.hold) return ["Paused", COLOR.warn];
  if (v.outlook?.state === "stopping") return ["Stopping soon", COLOR.warn];
  if (v.state?.charging) return ["Charging on solar", COLOR.solar];
  if (v.outlook?.state === "counting") return ["Starting soon", COLOR.solar];
  if (v.follow === "ready") return ["Ready to go", COLOR.solar];
  return ["Waiting for sun", COLOR.inkMuted];
}

/**
 * How the car charges at home, as a small card: by hand or from solar only (two tiles), what's next while it follows
 * the sun ("Starting in 1:42"), and starting, stopping and its speed by hand. Its settings are cards of their own.
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
  const c = v.control;
  const s = v.state;
  const busy = command.isPending || !!fixed?.pending;
  const blocked = !!fixed && !fixed.can_command;
  // While the dashboard follows the sun it sets the speed itself; by hand only when it's manual or paused.
  const auto = c.mode !== "off" && !v.hold;
  const { amps, step, waiting, asking, confirm, cancel } = useAmps(v, command);
  // Starting or stopping an asleep car wakes it: asked first.
  const [askAction, setAskAction] = useState<"start" | "stop" | null>(null);
  const act = (action: "start" | "stop") => (s?.asleep ? setAskAction(action) : command.mutate({ vin: v.vin, action }));
  const perAmp = v.volts && v.phases ? v.volts * v.phases : null;
  const ampsText = amps != null ? `${amps} A${perAmp ? ` · ${kW(amps * perAmp)}` : ""}` : "—";
  const live = useSpareNow(v);
  const [status, tone] = statusOf(v);
  const modes = fixed
    ? MODES.map((m) => (m.value === "solar" ? { ...m, sub: "When there's enough sun for its charger" } : m))
    : MODES;

  return (
    <SmallCard
      id={`h-tc-${v.vin}`}
      title="Charging"
      note={
        <span className="flex items-center gap-1.5">
          <Dot color={tone} />
          {status}
        </span>
      }
      className={className}
    >
      <ChoiceTiles
        label="How your car charges"
        options={modes}
        value={c.mode}
        onChange={(mode) => configure.mutate({ vin: v.vin, mode })}
      />
      {c.mode === "solar" && !fixed && <SolarOutlook v={v} live={live} />}
      {c.mode === "solar" && s?.at_home === false && s.in_range == null && s.plugged && (
        <Notice tone="warn" className="flex flex-wrap items-center justify-between gap-3">
          <span>The car doesn't seem to be at home, so it won't charge from solar here. Is this your home?</span>
          <Button size="sm" variant="outline" onClick={() => configure.mutate({ vin: v.vin, home: "here" })}>
            Set as home
          </Button>
        </Notice>
      )}
      {configure.isError && <HelpText tone="bad">{errorMessage(configure.error)}</HelpText>}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-3">
        {s?.charging ? (
          <Button variant="outline" size="sm" disabled={busy || blocked} onClick={() => act("stop")}>
            <Icon name="pause" size={15} /> Stop charging
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={busy || blocked || !s?.plugged || s.charging_state === "Complete"}
            onClick={() => act("start")}
          >
            <Icon name="bolt" size={15} /> Start charging
          </Button>
        )}
        {!s?.plugged && !s?.charging && <HelpText>Plug the car in at home to start charging.</HelpText>}
        {fixed ? (
          <span className="text-xs text-ink-faint tabular-nums">Charges at {kW(fixed.min_w ?? 0)}</span>
        ) : auto ? (
          s?.charging && <span className="text-xs text-ink-faint tabular-nums">{ampsText}, set by the sun</span>
        ) : (
          <Stepper
            label="Charging speed"
            text={ampsText}
            less={amps != null && amps > 1}
            more={amps != null && amps < (v.max_amps ?? 32)}
            onStep={step}
          />
        )}
      </div>
      {(asking || askAction) && (
        <Notice tone="warn" className="flex flex-col gap-3">
          <span className="text-pretty">
            <b className="font-semibold">
              {asking ? `Set the current to ${amps} A?` : askAction === "start" ? "Start charging?" : "Stop charging?"}
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
              {asking ? `Wake and set ${amps} A` : askAction === "start" ? "Wake and start" : "Wake and stop"}
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
                  ? `Sent to the car at ${hhmm(fixed.pending.at)}. Waiting for it to confirm.`
                  : c.mode !== "off"
                    ? `Starting or stopping it here or in the ${app} app pauses solar charging until you unplug.`
                    : ""}
      </HelpText>
    </SmallCard>
  );
}

/**
 * The spare sun for the car, while it charges from solar: how much there is now against what it takes to start and
 * each amp past that (or, for a Hyundai or Kia, the one power its charger gives). With no home battery to share it
 * with, where the sun's going now too.
 */
export function EvSpareSun({
  v,
  brand = "tesla",
  className,
}: {
  v: EvVehicle | BluelinkCar;
  brand?: EvBrand;
  className?: string;
}) {
  const live = useSpareNow(v);
  const hasBattery = useHasBattery();
  const fixed = brand === "bluelink";
  const perAmp = v.volts && v.phases ? v.volts * v.phases : null;
  const s = v.state;
  if (v.control.mode !== "solar") return null;
  return (
    <SmallCard
      id={`h-ts-${v.vin}`}
      title="Spare solar"
      note={
        fixed
          ? `Starts at ${kW(v.min_w ?? 0)}`
          : perAmp && v.phases
            ? `${v.phases === 1 ? "Single-phase" : `${v.phases}-phase`} · ${kW(perAmp)} an amp`
            : undefined
      }
      className={className}
    >
      {fixed ? <FixedMeter v={v} /> : <AmpMeter v={v} live={live} />}
      {!hasBattery && <SunShare carW={s?.charging ? (s.power_kw ?? 0) * 1000 : 0} first={v.control.first} />}
      {!fixed && v.min_w != null && v.min_amps != null && perAmp != null && (
        <CardText>
          It starts once {kW(v.min_w)} is spare, at {v.min_amps} A, and goes up an amp for each {kW(perAmp)} more.
        </CardText>
      )}
    </SmallCard>
  );
}

/**
 * Who gets the sun first, the car or your home battery, while it charges from solar: three tiles, a line on what the
 * one chosen means today, and where the sun's going now in that order. Only with a home battery to share it with.
 */
export function EvSunFirst({
  v,
  brand = "tesla",
  className,
}: {
  v: EvVehicle | BluelinkCar;
  brand?: EvBrand;
  className?: string;
}) {
  const { configure } = useEvChange(brand);
  const hasBattery = useHasBattery();
  const c = v.control;
  const s = v.state;
  if (c.mode !== "solar" || !hasBattery) return null;
  const share = v.share;
  const about =
    c.first === "battery"
      ? "Your home battery fills up first. The car gets whatever's left after that."
      : c.first === "car"
        ? "The car charges first. Your home battery fills up from whatever's left."
        : !share
          ? "Your home battery gets just enough to be full by sunset, and the car gets the rest."
          : share.battery <= 0
            ? "Your home battery's full, so the car gets all the spare sun."
            : share.battery >= 1
              ? "Your home battery might not be full by sunset, so it comes first for now. The car gets the rest."
              : `Your home battery needs about ${share.need_kwh} kWh more to be full by sunset, so it gets about ${Math.round(share.battery * 100)}% of what it could take. The car gets the rest.`;
  return (
    <SmallCard id={`h-tf-${v.vin}`} title="Priority" note={FIRST_WORDS[c.first]} className={className}>
      <ChoiceTiles
        label="Who gets the sun first"
        options={FIRST}
        value={c.first}
        onChange={(first) => configure.mutate({ vin: v.vin, first })}
      />
      <CardText>{about}</CardText>
      <SunShare carW={s?.charging ? (s.power_kw ?? 0) * 1000 : 0} first={c.first} />
    </SmallCard>
  );
}

/**
 * What it may take at home: the most a Tesla may draw (your socket's or circuit's limit), or the charger a Hyundai or
 * Kia is on, and while it charges from solar, how much it may borrow to ride out a cloud.
 */
export function EvLimits({
  v,
  brand = "tesla",
  className,
}: {
  v: EvVehicle | BluelinkCar;
  brand?: EvBrand;
  className?: string;
}) {
  const { configure } = useEvChange(brand);
  const fixed = brand === "bluelink" ? (v as BluelinkCar) : null;
  const solar = v.control.mode === "solar";
  if (fixed && !solar) return null;
  return (
    <SmallCard id={`h-tl-${v.vin}`} title="Limits" note="At home" className={className}>
      {fixed ? (
        <ChargePower v={fixed} onSave={(w) => configure.mutate({ vin: v.vin, charge_w: w })} />
      ) : (
        <MostAmps v={v} configure={configure} />
      )}
      {solar && <ShortBy v={v} onSave={(w) => configure.mutate({ vin: v.vin, grid_w: w })} />}
      {configure.isError && <HelpText tone="bad">{errorMessage(configure.error)}</HelpText>}
    </SmallCard>
  );
}
