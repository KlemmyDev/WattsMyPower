import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { batteryQuery } from "~/features/battery/api";
import { useBatteryChange } from "~/features/battery/hooks";
import type { BatteryControl, BatteryOwner, BatteryView, ControlKind, ControlRequest } from "~/features/battery/types";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { Button } from "~/features/common/ui/components/Button";
import { Card, CardHeader } from "~/features/common/ui/components/Card";
import { HelpText, Input } from "~/features/common/ui/components/Field";
import { Notice } from "~/features/common/ui/components/Notice";
import { Pill, type PillTone } from "~/features/common/ui/components/Pill";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { cn } from "~/features/common/ui/utils";
import { useNow } from "~/features/common/time/hooks";

type Lasting = "1h" | "3h" | "at" | "open";

const KINDS: { value: ControlKind; label: string }[] = [
  { value: "standby", label: "Standby" },
  { value: "floor", label: "Set a floor" },
  { value: "charge", label: "Charge from grid" },
];

const LASTING: { value: Lasting; label: string }[] = [
  { value: "1h", label: "1 hour" },
  { value: "3h", label: "3 hours" },
  { value: "at", label: "Until…" },
  { value: "open", label: "Until I stop it" },
];

const ABOUT: Record<ControlKind, string> = {
  standby:
    "The battery neither charges nor discharges: the house runs on solar and the grid, and the battery keeps what it " +
    "has for later. Any spare solar goes to the grid.",
  floor:
    "The battery runs the house as usual until it's down to the floor, then the grid takes over and the rest is kept " +
    "for later. Spare solar still charges it.",
  charge:
    "The battery charges at a set power, from the grid when solar can't cover it, until it reaches the level you " +
    "choose. Then it goes back to normal.",
};

/** The button: starting it, switching to it from another control, or changing the one in effect. */
const START: Record<ControlKind, [string, string, string]> = {
  standby: ["Put on standby", "Switch to standby", "Change how long"],
  floor: ["Set the floor", "Switch to a floor", "Change the floor"],
  charge: ["Start charging", "Switch to charging", "Change the charge"],
};

/** Unix seconds of the next `hh:mm` (local) after `now`: today, or tomorrow if that's already passed. */
function nextAt(hm: string, now: number): number | null {
  const [h, m] = hm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const d = new Date(now * 1000);
  d.setHours(h, m, 0, 0);
  if (d.getTime() / 1000 <= now + 60) d.setDate(d.getDate() + 1);
  return Math.floor(d.getTime() / 1000);
}

/** "14:05", "tomorrow 06:00", or "Thu 9 Oct 06:00". */
function when(ts: number, now: number): string {
  const day = (t: number) => new Date(t * 1000).toDateString();
  if (day(ts) === day(now)) return hhmm(ts);
  if (day(ts) === day(now + 86400)) return `tomorrow ${hhmm(ts)}`;
  return `${shortDay.format(new Date(ts * 1000))} ${hhmm(ts)}`;
}

const kw = (w: number | null | undefined) => `${((w ?? 0) / 1000).toFixed(1)} kW`;

function status(owner: BatteryOwner | null, c: BatteryControl | null): [string, PillTone] {
  if (c && !c.ending) {
    if (c.kind === "standby") return ["Standby", "brand"];
    if (c.kind === "floor") return [`Floor ${c.floor}%`, "brand"];
    return ["Charging", "brand"];
  }
  if (owner === "normal") return ["Normal", "neutral"];
  if (owner === "isolarcloud") return ["iSolarCloud", "inverse"];
  if (owner == null) return ["Can't read", "bad"];
  return ["Controlled elsewhere", "inverse"];
}

/** What the control in effect does, in a sentence. */
function describe(c: BatteryControl, now: number): string {
  const until = c.until ? ` until ${when(c.until, now)}` : " until you stop it";
  if (c.kind === "standby")
    return `On standby${until}. The house runs on solar and the grid, and the battery keeps its charge.`;
  if (c.kind === "floor")
    return `Floor at ${c.floor}%${until}. The battery runs the house until it's down to ${c.floor}%, then the grid takes over.`;
  return `Charging at ${kw(c.power_w)} to ${c.target}%${c.until ? ` (or until ${when(c.until, now)})` : ""}, from the grid when solar can't cover it.`;
}

/**
 * The battery controls: standby (neither charge nor discharge), a floor it won't discharge below, or a charge from the
 * grid, each for a while or until stopped. While iSolarCloud or anything else has the battery, it only says what's
 * going on: nothing is changed.
 */
export function BatteryControlCard({ className }: { className?: string }) {
  const { data: v } = useQuery(batteryQuery);
  if (!v?.supported) return null;
  return <Controls v={v} className={className} />;
}

function Controls({ v, className }: { v: Extract<BatteryView, { supported: true }>; className?: string }) {
  const now = useNow(30_000);
  const { start, stop } = useBatteryChange();
  const c = v.control;
  const [kind, setKind] = useState<ControlKind>(c?.kind ?? "standby");
  const [lasting, setLasting] = useState<Lasting>("3h");
  const [at, setAt] = useState("06:00");
  const [floor, setFloor] = useState(String(c?.floor ?? 30));
  const [power, setPower] = useState(String(Math.min(5, v.limits.charge_w[1] / 1000)));
  const [target, setTarget] = useState(String(Math.round(v.settings?.max_soc ?? 100)));
  const [invalid, setInvalid] = useState("");

  const [label, tone] = status(v.owner, c);
  const active = c && !c.ending;
  const until =
    lasting === "1h" ? now + 3600 : lasting === "3h" ? now + 3 * 3600 : lasting === "at" ? nextAt(at, now) : null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setInvalid("");
    const body: ControlRequest = { kind, until };
    if (lasting === "at" && until == null) return setInvalid("Choose a time.");
    if (kind === "floor") {
      const [low, high] = v.limits.floor;
      const n = Number(floor);
      if (!Number.isFinite(n) || n < low || n > high)
        return setInvalid(`The floor must be between ${low}% and ${high}%.`);
      body.floor = Math.round(n);
    }
    if (kind === "charge") {
      const p = Number(power) * 1000;
      const t = Number(target);
      const [low, high] = v.limits.charge_w;
      if (!Number.isFinite(p) || p < low || p > high)
        return setInvalid(`The power must be between ${kw(low)} and ${kw(high)}.`);
      if (!Number.isFinite(t) || t < 10 || t > 100) return setInvalid("Charge to a level between 10% and 100%.");
      body.power_w = Math.round(p);
      body.target = Math.round(t);
    }
    start.mutate(body);
  };
  const failed = start.error ?? stop.error;

  return (
    <Card aria-labelledby="h-batctl" className={cn("gap-5", className)}>
      <CardHeader title="Battery control" id="h-batctl" action={<Pill tone={tone}>{label}</Pill>} />
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4">
          {active ? (
            <div className="flex flex-col items-start gap-3">
              <p className="text-[15px] text-pretty">{describe(c, now)}</p>
              {!c.confirmed && (
                <HelpText>Sent to the inverter: waiting for it to show the change (up to a few minutes).</HelpText>
              )}
              <Button variant="outline" size="sm" disabled={stop.isPending} onClick={() => stop.mutate()}>
                {stop.isPending ? "Putting it back…" : "Back to normal"}
              </Button>
            </div>
          ) : c?.ending ? (
            <p className="text-[15px] text-pretty">
              The floor has ended. Your usual {c.usual_floor}% floor goes back once iSolarCloud's command ends.
            </p>
          ) : v.owner === "normal" ? (
            <p className="text-[15px] text-pretty text-ink-muted">
              Normal: the battery runs the house and charges from spare solar, keeping {v.settings?.min_soc ?? "its"}%
              in reserve.
            </p>
          ) : null}
          {v.blocked && <Notice tone="warn">{v.blocked}</Notice>}
        </div>

        {!v.blocked && (
          <form onSubmit={submit} className="flex flex-col gap-4">
            <Segmented
              label="Control"
              options={KINDS}
              value={kind}
              onChange={setKind}
              className="self-start max-sm:self-stretch"
              buttonClassName="max-sm:flex-1 max-sm:px-2 max-sm:justify-center"
            />
            <p className="text-[13px] text-pretty text-ink-muted">{ABOUT[kind]}</p>
            {kind === "floor" && (
              <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                Keep at least
                <Input
                  unit="%"
                  inputMode="numeric"
                  value={floor}
                  onChange={(e) => setFloor(e.target.value)}
                  boxClassName="w-[150px]"
                />
                <HelpText>
                  Between {v.limits.floor[0]}% and {v.limits.floor[1]}%. Usually {c?.usual_floor ?? v.settings?.min_soc}
                  %.
                </HelpText>
              </label>
            )}
            {kind === "charge" && (
              <div className="flex flex-wrap gap-4">
                <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                  At
                  <Input
                    unit="kW"
                    inputMode="decimal"
                    value={power}
                    onChange={(e) => setPower(e.target.value)}
                    boxClassName="w-[150px]"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
                  Up to
                  <Input
                    unit="%"
                    inputMode="numeric"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    boxClassName="w-[150px]"
                  />
                </label>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold">{kind === "charge" ? "Stop by" : "For"}</span>
              <div className="flex flex-wrap items-center gap-3">
                <Segmented
                  label="How long"
                  options={
                    kind === "charge"
                      ? LASTING.map((o) => (o.value === "open" ? { ...o, label: "No time limit" } : o))
                      : LASTING
                  }
                  value={lasting}
                  onChange={setLasting}
                  className="max-sm:self-stretch"
                  buttonClassName="max-sm:flex-1 max-sm:px-2 max-sm:justify-center"
                />
                {lasting === "at" && (
                  <span className="flex items-center gap-2 text-sm text-ink-muted">
                    <Input
                      type="time"
                      aria-label="Until"
                      value={at}
                      onChange={(e) => setAt(e.target.value)}
                      boxClassName="h-9 w-[150px]"
                    />
                    {until != null && new Date(until * 1000).toDateString() !== new Date(now * 1000).toDateString()
                      ? "tomorrow"
                      : "today"}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={start.isPending}>
                {start.isPending ? "Sending to the inverter…" : START[kind][!active ? 0 : c.kind === kind ? 2 : 1]}
              </Button>
            </div>
            {(invalid || failed) && <HelpText tone="bad">{invalid || errorMessage(failed)}</HelpText>}
          </form>
        )}
        {v.log.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="font-mono text-[11px] tracking-[1.5px] text-ink-faint uppercase">Recently</span>
            <ul className="flex flex-col gap-1 text-[13px] text-ink-muted">
              {v.log.slice(0, 5).map((e) => (
                <li key={`${e.ts}-${e.text}`} className="flex gap-3">
                  <span className="w-[92px] flex-none tabular-nums">{when(e.ts, now)}</span>
                  <span className="text-pretty">
                    {e.text}
                    {e.until ? ` until ${when(e.until, e.ts)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
