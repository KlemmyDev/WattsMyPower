import type { ReactNode } from "react";
import { BatteryDayChart } from "~/features/battery/components/BatteryDayChart";
import { useBatteryChange } from "~/features/battery/hooks";
import type { BatteryPlan, BatteryView, ControlRequest } from "~/features/battery/types";
import { describeMode, isFull, KIND_COLOR, when } from "~/features/battery/utils";
import { fullAgain, inOutToday, lowestAhead } from "~/features/battery/utils/today";
import { errorMessage } from "~/features/common/api/utils";
import { batteryState, batteryTone, ON, reserveOf } from "~/features/common/energy/utils";
import { duration, hhmm } from "~/features/common/formatting/utils/date";
import { centsShort, DASH, kW, kWh, money, pct } from "~/features/common/formatting/utils/number";
import type { BatteryMode, Snapshot, SystemInfo } from "~/features/common/live/types";
import type { HistorySeries } from "~/features/common/readings/types";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { midnight } from "~/features/common/time/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { HelpText } from "~/features/common/ui/components/Field";
import { Delta, Figure, LiveDot } from "~/features/common/ui/components/Live";
import { Notice } from "~/features/common/ui/components/Notice";
import { useToast } from "~/features/common/ui/components/Toast";
import { useTween } from "~/features/common/ui/hooks/useTween";
import { cn } from "~/features/common/ui/utils";
import { rateAt } from "~/features/home/components/RateStrip";
import { useRates } from "~/features/home/hooks";

type Supported = Extract<BatteryView, { supported: true }>;

/**
 * The battery today and now, in one card, as Solar's and Home's: its level and what it's set to do, what it's putting
 * in or out now and how long that lasts, what went in and came out today, what power costs now and the reserve it
 * keeps; the level along a bar with the reserve, the lowest it's expected to get and when it's full again; while a
 * control runs, one button back to normal; and, unless `chart` is off, the day of its level with what it was set to do,
 * through tomorrow as things are set, with each hour in and out and the rates under it.
 */
export function BatteryHero({
  v,
  p,
  s,
  mode,
  series,
  now,
  preview = null,
  draft = null,
  chart = true,
}: {
  v: Supported | undefined;
  p: Snapshot | null;
  s: SystemInfo | undefined;
  mode: BatteryMode | null;
  series: HistorySeries | undefined;
  now: number;
  /** What the control being set up would do, and its settings this moment (the Control card's), for the chart. */
  preview?: BatteryPlan | null;
  draft?: ControlRequest | null;
  chart?: boolean;
}) {
  const soc = useTween(p?.battery_soc) ?? p?.battery_soc ?? null;
  const power = p?.battery_power;
  const st = batteryState(power);
  const cap = s?.battery_kwh ?? 0;
  const c = v?.control && !v.control.ending ? v.control : null;
  const m = mode ? describeMode(mode, now) : null;
  const reserve = c?.kind === "floor" && c.floor != null ? c.floor : reserveOf(s);
  const top = v?.settings?.max_soc ?? 100;
  // Resting at the top it's allowed to charge to (short of 100% on some): full, rather than idle.
  const full = !c && st === "idle" && isFull(soc, top);
  const tint = st === "discharge" ? batteryTone(power) : COLOR.battery;
  // A control here in its own colour; anything else that has the battery (iSolarCloud, an energy manager) in amber.
  const modeColor = c ? KIND_COLOR[c.kind] : COLOR.warn;
  const io = inOutToday(series, p);
  const rate = rateAt(useRates(midnight(now)), now);
  const low = lowestAhead(v?.outlook, soc, now);
  const fullAt = full ? null : fullAgain(v?.outlook, now, top);
  const max = s?.battery_max_kw;
  // How long until full, or down to the reserve, at the rate it's going now.
  const eta =
    soc != null && cap && power
      ? st === "charge"
        ? (((top - soc) / 100) * cap) / (-power / 1000)
        : st === "discharge"
          ? (((soc - reserve) / 100) * cap) / (power / 1000)
          : null
      : null;
  const etaText = eta != null && eta > 0 && eta < 48 ? duration(eta * 3600) : null;

  return (
    <Card
      aria-label="Battery today and now"
      className="h-full gap-6"
      style={{ backgroundImage: `linear-gradient(180deg, ${alpha(tint, 0.1)}, transparent 45%)` }}
    >
      {/* On a phone the rows below come apart (contents) so the level bar can sit right under the level. */}
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5 max-sm:contents">
        <div className="flex flex-wrap items-end gap-x-8 gap-y-5 max-sm:contents">
          <div className="flex flex-col gap-1.5 max-sm:-order-2">
            <span className="text-[13px] text-ink-muted">Level</span>
            <Figure value={soc == null ? DASH : Math.round(soc)} unit={soc == null ? undefined : "%"} size="xl" />
            <span className="flex flex-wrap items-center gap-2 text-[13px] text-ink-muted tabular-nums">
              {soc != null && cap ? `${kWh((soc / 100) * cap)} of ${kWh(cap)}` : "No reading yet"}
              {m && (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium whitespace-nowrap",
                    !m.special && "bg-fg/6 text-ink-muted",
                  )}
                  style={m.special ? { background: alpha(modeColor, 0.14), color: modeColor } : undefined}
                >
                  {m.label}
                  {m.detail && ` · ${m.detail}`}
                </span>
              )}
            </span>
          </div>
          <div className="flex flex-col gap-1.5 border-l border-line-subtle pl-6 max-sm:border-l-0 max-sm:pl-0">
            <span className="flex items-center gap-2 text-[13px] text-ink-muted">
              <LiveDot on={st === "charge" || st === "discharge"} color={tint} />
              {c?.kind === "standby"
                ? "On standby"
                : full
                  ? "Full"
                  : st === "charge"
                    ? "Charging now"
                    : st === "discharge"
                      ? "Discharging now"
                      : "Idle"}
            </span>
            {full ? (
              <Figure value={pct(Math.round(soc ?? 100))} />
            ) : (
              <Figure {...split(power == null ? null : kW(Math.abs(power)))} />
            )}
            <span className="flex flex-wrap items-center gap-2 text-xs text-ink-muted tabular-nums">
              {full
                ? (p?.pv_power ?? 0) > ON
                  ? "Solar's running your home"
                  : "Topped up"
                : st === "charge"
                  ? `Into the battery${fullAt ? ` · full by ${when(fullAt, now)}` : etaText ? ` · full in ${etaText}` : ""}`
                  : st === "discharge"
                    ? `To your home${etaText ? ` · ${etaText} to its reserve` : ""}`
                    : "Nothing in or out"}
              {max && power != null && Math.abs(power) > ON && (
                <Delta value={0}>
                  {pct((Math.abs(power) / (max * 1000)) * 100)} of its {max} kW
                </Delta>
              )}
            </span>
          </div>
        </div>
        <dl className="grid grid-cols-4 gap-x-8 gap-y-3 max-md:grid-cols-2">
          <Stat
            label="Charged today"
            value={p?.daily_charge != null || series ? kWh(io.charged) : DASH}
            sub={
              io.charged < 0.05
                ? undefined
                : io.grid < 0.05
                  ? "All from solar"
                  : io.solar < 0.05
                    ? "All from the grid"
                    : `${kWh(io.solar)} from solar`
            }
          />
          <Stat
            label="Discharged today"
            value={p?.daily_discharge != null || series ? kWh(io.discharged) : DASH}
            sub={io.discharged < 0.05 ? undefined : io.out < 0.05 ? "All to your home" : `${kWh(io.home)} to your home`}
          />
          <Stat
            label="Power costs now"
            value={rate ? `${centsShort(rate.rate)}/kWh` : DASH}
            sub={rate ? `${rate.name} until ${hhmm(rate.to)}` : undefined}
          />
          <Stat
            label="Reserve"
            value={pct(reserve)}
            sub={c?.kind === "floor" ? "Raised for now" : "For when the grid's down"}
          />
        </dl>
      </div>
      <LevelBar
        soc={soc}
        reserve={reserve}
        raised={c?.kind === "floor"}
        paused={c?.kind === "standby"}
        tone={c ? KIND_COLOR[c.kind] : tint}
        target={c?.kind === "charge" ? (c.target ?? null) : null}
        low={low}
        fullAt={fullAt}
        full={full}
        now={now}
        className="max-sm:-order-1"
      />
      {(c || v?.blocked) && <Controlled v={v!} now={now} />}
      {chart && (
        <BatteryDayChart
          s={s}
          now={now}
          plan={v?.plan ?? null}
          outlook={v?.outlook ?? null}
          preview={preview}
          draft={draft}
        />
      )}
    </Card>
  );
}

/** "2.10 kW" as a figure and its unit. */
const split = (text: string | null) => {
  if (!text) return { value: DASH };
  const [value, unit] = text.split(" ");
  return { value, unit };
};

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="text-[20px] leading-6 font-light tracking-[-0.3px] whitespace-nowrap tabular-nums">{value}</dd>
      {sub && <dd className="truncate text-[11.5px] text-ink-faint">{sub}</dd>}
    </div>
  );
}

/**
 * The level along one bar out of 100%: the reserve it keeps hatched in and marked (lilac while it's raised), a tick
 * for the lowest it's expected to get as things are set, and a charge's target; with what each is said below it.
 */
function LevelBar({
  soc,
  reserve,
  raised,
  paused,
  tone,
  target,
  low,
  fullAt,
  full,
  now,
  className,
}: {
  soc: number | null;
  reserve: number;
  raised: boolean;
  paused: boolean;
  tone: string;
  target: number | null;
  low: { t: number; soc: number } | null;
  fullAt: number | null;
  full: boolean;
  now: number;
  className?: string;
}) {
  const at = (v: number) => `${Math.max(0, Math.min(100, v))}%`;
  const reserveColor = raised ? KIND_COLOR.floor : undefined;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="relative h-2.5 rounded-full bg-track">
        <span
          className={cn(
            "absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out-soft",
            paused && "opacity-60",
          )}
          style={{ width: at(soc ?? 0), background: `linear-gradient(90deg, ${alpha(tone, 0.55)}, ${tone})` }}
        />
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-l-full"
          style={{
            width: at(reserve),
            background: `repeating-linear-gradient(135deg, ${alpha(COLOR.fg, 0.16)} 0 3px, transparent 3px 6px)`,
          }}
        />
        <span
          title="The reserve it keeps"
          className={cn("absolute -inset-y-1.5 w-0.5 -translate-x-1/2 rounded-full", !reserveColor && "bg-ink")}
          style={{ left: at(reserve), background: reserveColor }}
        />
        {low && (
          <span
            title="The lowest it's expected to get"
            className="absolute -inset-y-1.5 w-0.5 -translate-x-1/2 rounded-full"
            style={{ left: at(low.soc), background: COLOR.warn }}
          />
        )}
        {target != null && (
          <span
            title="What it's charging to"
            className="absolute -inset-y-1.5 w-0.5 -translate-x-1/2 rounded-full"
            style={{ left: at(target), background: KIND_COLOR.charge }}
          />
        )}
      </div>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-ink-faint tabular-nums">
        <span className="flex items-center gap-1.5">
          <i
            className={cn("h-2.5 w-0.5 rounded-full", !reserveColor && "bg-ink")}
            style={{ background: reserveColor }}
          />
          {pct(reserve)} reserve, {raised ? "raised for now" : "kept for a blackout"}
        </span>
        {low && (
          <span className="flex items-center gap-1.5">
            <i className="h-2.5 w-0.5 rounded-full" style={{ background: COLOR.warn }} />
            Lowest {pct(Math.round(low.soc))} at {when(low.t, now)}, as things are set
          </span>
        )}
        {target != null && (
          <span className="flex items-center gap-1.5">
            <i className="h-2.5 w-0.5 rounded-full" style={{ background: KIND_COLOR.charge }} />
            Charging to {pct(target)}
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <i className="size-2 rounded-full" style={{ background: COLOR.battery }} />
          {full ? "Full now" : fullAt ? `Full again by ${when(fullAt, now)}` : "Not expected to fill by tomorrow night"}
        </span>
      </div>
    </div>
  );
}

/** While a control runs: one button back to normal, what it will do and when it ends; or why the controls are off. */
function Controlled({ v, now }: { v: Supported; now: number }) {
  const { stop } = useBatteryChange();
  const toast = useToast();
  const c = v.control && !v.control.ending ? v.control : null;
  return (
    <div className="flex flex-col gap-4">
      {c && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            variant="outline"
            size="sm"
            disabled={stop.isPending}
            onClick={() =>
              stop.mutate(undefined, {
                onSuccess: () => toast("The battery is back to normal."),
                onError: (e) => toast(errorMessage(e)),
              })
            }
          >
            {stop.isPending ? "Putting it back…" : "Back to normal"}
          </Button>
          {v.plan && (
            <span className="text-[13px] text-ink-muted tabular-nums">
              {c.kind === "charge"
                ? `${v.plan.reaches ? "Done" : "Stops"} at about ${when(v.plan.ends_at ?? v.plan.to, now)} · ${kWh(v.plan.charge_grid_kwh ?? 0)} from the grid, about ${money(v.plan.charge_cost ?? 0)}`
                : `About ${money(v.plan.cost)} from the grid${v.plan.ends_at ? ` until ${when(v.plan.ends_at, now)}` : " over the next 12 hours"}`}
            </span>
          )}
          {c.until && <span className="text-xs text-ink-faint">Back to normal at {when(c.until, now)}</span>}
        </div>
      )}
      {c && !c.confirmed && <HelpText>Sent to the inverter. It can take a minute or two to show the change.</HelpText>}
      {v.blocked && <Notice tone="warn">{v.blocked}</Notice>}
    </div>
  );
}
