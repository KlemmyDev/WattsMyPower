import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { CSSProperties, ReactNode } from "react";
import { batteryState, batteryTone, ON, reserveOf } from "~/features/common/energy/utils";
import { duration, hhmm, parseYmd, shortDay } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, pct } from "~/features/common/formatting/utils/number";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import type { HistorySeries } from "~/features/common/readings/types";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, midnight } from "~/features/common/time/utils";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { TooltipRow } from "~/features/common/ui/components/ChartHover";
import { TimeLine } from "~/features/common/ui/components/TimeLine";
import { cn } from "~/features/common/ui/utils";
import type { Forecast } from "~/features/common/weather/types";
import { gridQuery } from "~/features/grid/api";
import { LEVEL } from "~/features/grid/utils";
import { dailyQuery } from "~/features/history/api";

const CHARGE = COLOR.battery;
// Discharging is amber everywhere (batteryTone).
const DISCHARGE = batteryTone(ON + 1);

/** A figure in a card's corner, with what it is above it. */
function Corner({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-none flex-col items-end gap-0.5">
      <span className="text-xs text-ink-faint">{label}</span>
      <span className="text-[28px] leading-8 font-light tracking-[-1px] tabular-nums">{children}</span>
    </div>
  );
}

function Split({
  parts,
  total,
}: {
  parts: { key: string; label: string; kwh: number; color: string }[];
  total: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-fg/6">
        {total > 0 &&
          parts
            .filter((x) => x.kwh > 0.005)
            .map((x) => (
              <span
                key={x.key}
                className="h-full transition-[flex-grow] duration-700 ease-out-soft"
                style={{ flexGrow: x.kwh, background: x.color } as CSSProperties}
              />
            ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        {parts.map((x) => (
          <li key={x.key} className="flex items-center gap-1.5">
            <i aria-hidden className="size-2 rounded-full" style={{ background: x.color }} />
            {x.label} <span className="text-ink tabular-nums">{kWh(x.kwh)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Where today's charge came from and where the discharge went, from the 5-minute readings: while charging, solar goes
 * to the house first and the grid makes up the rest; while discharging, the house comes first and the rest is
 * exported. Plus the time to full or to the reserve at the rate it's going now.
 */
export function BatteryToday({
  series,
  p,
  s,
  className,
}: {
  series: HistorySeries | undefined;
  p: Snapshot | null;
  s: SystemInfo | undefined;
  className?: string;
}) {
  const f = { solar: 0, grid: 0, home: 0, out: 0 };
  if (series) {
    const t = series.t;
    for (let i = 0; i < t.length; i++) {
      const bat = series.battery_power?.[i];
      if (bat == null) continue;
      const step = ((t[i + 1] ?? t[i] + 300) - t[i]) / 3600;
      const pv = Math.max(0, series.pv_power?.[i] ?? 0);
      const load = Math.max(0, series.load_power?.[i] ?? 0);
      const grid = series.grid_power?.[i] ?? 0;
      if (bat < -ON) {
        const charge = -bat / 1000;
        const fromGrid = Math.max(0, Math.min(charge, (Math.max(0, grid) - Math.max(0, load - pv)) / 1000));
        f.grid += fromGrid * step;
        f.solar += (charge - fromGrid) * step;
      } else if (bat > ON) {
        const dis = bat / 1000;
        const toGrid = Math.max(0, Math.min(dis, (Math.max(0, -grid) - Math.max(0, pv - load)) / 1000));
        f.out += toGrid * step;
        f.home += (dis - toGrid) * step;
      }
    }
  }
  const charged = p?.daily_charge ?? f.solar + f.grid;
  const discharged = p?.daily_discharge ?? f.home + f.out;
  // The counters are what the inverter counted; the split is from readings, scaled to them.
  const scale = (a: number, b: number, to: number) => (a + b > 0 ? [(a / (a + b)) * to, (b / (a + b)) * to] : [0, 0]);
  const [solar, grid] = scale(f.solar, f.grid, charged);
  const [home, out] = scale(f.home, f.out, discharged);
  const cap = s?.battery_kwh ?? 0;
  const soc = p?.battery_soc;
  const st = batteryState(p?.battery_power);
  const reserve = reserveOf(s);
  const eta =
    soc != null && cap && p?.battery_power
      ? st === "charge"
        ? { what: "Full", h: (((100 - soc) / 100) * cap) / (-p.battery_power / 1000) }
        : st === "discharge"
          ? { what: "At the reserve", h: (((soc - reserve) / 100) * cap) / (p.battery_power / 1000) }
          : null
      : null;
  return (
    <Card className={className}>
      <div className="flex items-end justify-between gap-3">
        <TitleBlock
          className="min-w-0 flex-1"
          title="In and out today"
          sub={
            cap && discharged
              ? `About ${(discharged / cap).toFixed(1)} of a full cycle so far`
              : "What went into the battery and what came out"
          }
        />
        {eta && eta.h > 0 && eta.h < 48 && (
          <Corner label={eta.what}>
            {duration(eta.h * 3600)
              .replace(" min", "m")
              .replace(" h ", "h ")}
          </Corner>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between text-[13.5px]">
          <span className="text-ink">Charged</span>
          <span className="text-ink tabular-nums">{kWh(charged)}</span>
        </span>
        <Split
          total={charged}
          parts={[
            { key: "solar", label: "From solar", kwh: solar, color: COLOR.solar },
            { key: "grid", label: "From the grid", kwh: grid, color: COLOR.import },
          ]}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between text-[13.5px]">
          <span className="text-ink">Discharged</span>
          <span className="text-ink tabular-nums">{kWh(discharged)}</span>
        </span>
        <Split
          total={discharged}
          parts={[
            { key: "home", label: "To the house", kwh: home, color: COLOR.teal },
            { key: "out", label: "To the grid", kwh: out, color: COLOR.export },
          ]}
        />
      </div>
    </Card>
  );
}

/**
 * How long the battery would keep the house going if the grid went down now: at what it's using now, and through the
 * house's usual hours from here (the forecast's typical day), with no solar. Needs backup power wired in (most
 * hybrids have it as an option); the Grid page's outlook says whether it's likely to be needed.
 */
export function BatteryBackup({
  p,
  s,
  f,
  now,
  className,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  now: number;
  className?: string;
}) {
  const { data: grid } = useQuery(gridQuery);
  const cap = s?.battery_kwh ?? 0;
  const soc = p?.battery_soc;
  const reserve = reserveOf(s);
  const usable = soc != null && cap ? Math.max(0, ((soc - reserve) / 100) * cap) : null;
  const load = p?.load_power != null && p.load_power > ON ? p.load_power / 1000 : null;
  const atNow = usable != null && load ? usable / load : null;
  // Through the typical day's hours from now, until it's used up.
  const profile = f?.load_basis?.profile_kw;
  let until: number | null = null;
  if (usable != null && profile?.length === 24) {
    let left = usable;
    let t = now;
    for (let i = 0; i < 48 && left > 0; i++) {
      const hourEnd = Math.floor(t / 3600) * 3600 + 3600;
      const kw = Math.max(0.05, profile[new Date(t * 1000).getHours()]);
      const need = (kw * (hourEnd - t)) / 3600;
      if (need >= left) {
        until = t + (left / kw) * 3600;
        left = 0;
      } else {
        left -= need;
        t = hourEnd;
      }
    }
    if (left > 0) until = null; // lasts more than two days of usual use
  }
  const level = grid?.outlook.level;
  return (
    <Card className={className}>
      <div className="flex items-end justify-between gap-3">
        <TitleBlock
          className="min-w-0 flex-1"
          title="If the grid went down"
          sub="How long the battery would keep the house going from now, with no solar, down to its reserve"
        />
        <Corner label="Usable now">{usable != null ? kWh(usable) : DASH}</Corner>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-0.5 rounded-2xl bg-fg/4 px-4 py-3">
          <span className="text-xs text-ink-muted">At what it's using now</span>
          <span className="text-xl font-light tabular-nums">{atNow != null ? duration(atNow * 3600) : DASH}</span>
          <span className="text-[11.5px] text-ink-faint">{load ? `${kW(load * 1000)} now` : "Hardly anything on"}</span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-2xl bg-fg/4 px-4 py-3">
          <span className="text-xs text-ink-muted">Through a usual day</span>
          <span className="text-xl font-light tabular-nums">
            {until != null ? `Until ${hhmm(until)}` : usable != null && profile ? "Over two days" : DASH}
          </span>
          <span className="text-[11.5px] text-ink-faint">
            {until != null && until - now > 86400 - 3600
              ? shortDay.format(new Date(until * 1000))
              : "Your typical use by the hour"}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-faint">
        <span>Only with backup power wired in. Reserve {pct(reserve)} kept back.</span>
        {level && (
          <Link to="/grid" className="flex items-center gap-1.5 text-ink-muted no-underline hover:text-ink">
            <i aria-hidden className="size-1.5 rounded-full" style={{ background: LEVEL[level].color }} />
            {LEVEL[level].word}
          </Link>
        )}
      </div>
    </Card>
  );
}

/**
 * What the battery reports now: its temperature through today against the range it's happiest in, its voltage and
 * current, and how hard it's working against its rate.
 */
export function BatteryReadings({
  series,
  p,
  s,
  start,
  now,
  className,
}: {
  series: HistorySeries | undefined;
  p: Snapshot | null;
  s: SystemInfo | undefined;
  start: number;
  now: number;
  className?: string;
}) {
  const temps = series ? series.t.map((t, i) => ({ t, v: series.battery_temp?.[i] ?? null })) : [];
  const vs = temps.map((x) => x.v).filter((v): v is number => v != null);
  const temp = p?.battery_temp;
  const power = p?.battery_power;
  const max = s?.battery_max_kw;
  const load = power != null && max ? Math.abs(power) / (max * 1000) : null;
  const volts = p?.battery_voltage;
  const amps = p?.battery_current;
  const hot = temp != null && temp > 40;
  const cold = temp != null && temp < 5;
  return (
    <Card className={className}>
      <div className="flex items-end justify-between gap-3">
        <TitleBlock
          className="min-w-0 flex-1"
          title="Readings"
          sub={
            hot
              ? "Running warm: it may hold back its rate until it cools"
              : cold
                ? "Cold: it may charge slowly until it warms up"
                : "What the battery reports, and its temperature through today"
          }
        />
        <Corner label="Temperature">{temp != null ? `${Math.round(temp)}°C` : DASH}</Corner>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <Reading label="Rate now" value={power != null && Math.abs(power) > ON ? kW(Math.abs(power)) : "Idle"}>
          {load != null && max ? `${pct(load * 100)} of ${max} kW` : undefined}
        </Reading>
        <Reading label="Voltage" value={volts != null ? `${volts.toFixed(0)} V` : DASH} />
        <Reading label="Current" value={amps != null ? `${Math.abs(amps).toFixed(1)} A` : DASH} />
      </div>
      {vs.length > 1 && (
        <TimeLine
          points={temps}
          start={start}
          end={addDays(start, 1)}
          now={now}
          color={COLOR.battery}
          height={110}
          domain={[Math.min(15, ...vs) - 2, Math.max(35, ...vs) + 2]}
          band={{ from: 15, to: 35, label: "15 to 35°C" }}
          tip={(pt) => (
            <>
              <span className="font-medium text-ink">{hhmm(pt.t)}</span>
              <TooltipRow
                label="Temperature"
                value={pt.v != null ? `${pt.v.toFixed(1)}°C` : DASH}
                color={COLOR.battery}
              />
            </>
          )}
        />
      )}
      {vs.length > 1 && (
        <span className="text-xs text-ink-faint">
          {Math.round(Math.min(...vs))} to {Math.round(Math.max(...vs))}°C today. Batteries last longest kept between
          about 15 and 35°C.
        </span>
      )}
    </Card>
  );
}

function Reading({ label, value, children }: { label: string; value: string; children?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-2xl bg-fg/4 px-3.5 py-3">
      <span className="text-xs text-ink-muted">{label}</span>
      <span className="text-lg font-light whitespace-nowrap tabular-nums">{value}</span>
      {children && <span className="text-[11.5px] text-ink-faint tabular-nums">{children}</span>}
    </div>
  );
}

/** The last 30 days: what went in and came out each day, with the average cycles a day. */
export function BatteryDays({ s, now, className }: { s: SystemInfo | undefined; now: number; className?: string }) {
  const end = midnight(now);
  const { data } = useQuery(dailyQuery(addDays(end, -30), end));
  const days = (data ?? []).filter((d) => d.daily_charge != null || d.daily_discharge != null);
  if (!days.length) return null;
  const top = Math.max(0.5, ...days.flatMap((d) => [d.daily_charge ?? 0, d.daily_discharge ?? 0]));
  const out = days.reduce((a, d) => a + (d.daily_discharge ?? 0), 0);
  const cap = s?.battery_kwh;
  return (
    <Card className={className}>
      <div className="flex items-end justify-between gap-3">
        <TitleBlock
          className="min-w-0 flex-1"
          title={`Last ${days.length} days`}
          sub={`${kWh(out)} delivered, ${kWh(out / days.length)} a day`}
        />
        {cap ? <Corner label="Cycles a day">{(out / days.length / cap).toFixed(2)}</Corner> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex h-28 items-end gap-[3px] max-sm:gap-px">
          {days.map((d, i) => (
            <div
              key={d.date}
              className="flex h-full min-w-0 flex-1 items-end gap-px"
              title={`${shortDay.format(parseYmd(d.date))}: charged ${kWh(d.daily_charge)}, discharged ${kWh(d.daily_discharge)}`}
            >
              {[
                [d.daily_charge ?? 0, CHARGE],
                [d.daily_discharge ?? 0, DISCHARGE],
              ].map(([v, c], k) => (
                <i
                  key={k}
                  className={cn("bar-grow block min-w-0 flex-1 rounded-[3px_3px_1px_1px]")}
                  style={
                    {
                      height: `${((v as number) / top) * 100}%`,
                      background: alpha(c as string, 0.8),
                      "--i": i,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          ))}
        </div>
        <div className="flex justify-between font-mono text-[11px] text-ink-faint">
          {[days[0], days[days.length - 1]].map((d) => (
            <span key={d.date}>{shortDay.format(parseYmd(d.date))}</span>
          ))}
        </div>
      </div>
      <div className="flex gap-4 text-xs text-ink-dim">
        <span className="flex items-center gap-1.5">
          <i className="size-2 rounded-xs" style={{ background: CHARGE }} />
          Charged
        </span>
        <span className="flex items-center gap-1.5">
          <i className="size-2 rounded-xs" style={{ background: DISCHARGE }} />
          Discharged
        </span>
      </div>
    </Card>
  );
}
