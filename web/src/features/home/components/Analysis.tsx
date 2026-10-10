import { useState, type CSSProperties, type ReactNode } from "react";
import { hhmm, hourLabel, parseYmd, shortDay } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, money } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, midnight } from "~/features/common/time/utils";
import { Card, Muted, TitleBlock } from "~/features/common/ui/components/Card";
import { DataRow } from "~/features/common/ui/components/DataRow";
import { ChartTooltip, TooltipRow, useBarHover } from "~/features/common/ui/components/ChartHover";
import { Pill } from "~/features/common/ui/components/Pill";
import { Swatch } from "~/features/common/ui/components/Swatch";
import { TimeLine, type LinePoint } from "~/features/common/ui/components/TimeLine";
import { cn } from "~/features/common/ui/utils";
import type { HomeDevice, HomePeak, HomeProfile } from "~/features/home/types";
import { WEEKDAY_SHORT } from "~/features/home/utils";

const USUAL = alpha(COLOR.fg, 0.45);
const WEEKDAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const mondayFirst = (d: Date) => (d.getDay() + 6) % 7;

/** A figure in a card's corner, with what it is above it and, optionally, below. */
function Corner({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-none flex-col items-end gap-0.5">
      <span className="text-xs text-ink-faint">{label}</span>
      <span className="text-[28px] leading-8 font-light tracking-[-1px] tabular-nums">{children}</span>
      {sub && <span className="text-xs text-ink-faint tabular-nums">{sub}</span>}
    </div>
  );
}

function Head({ title, sub, children }: { title: string; sub: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <TitleBlock className="min-w-0 flex-1" title={title} sub={sub} />
      {children}
    </div>
  );
}

/** Before the first day's readings are in, there's no usual to show. */
const LEARNING = "Builds up from a day of readings: what's usual, and what's likely ahead, sharpen over eight weeks.";

/**
 * Today's power through the day against a usual day (the same weekday's, once there are a few), with where today is
 * likely to end up: what's been used, plus the rest of a usual day.
 */
export function UsualDayCard({
  profile: p,
  color,
  now,
  className,
}: {
  profile: HomeProfile;
  color: string;
  now: number;
  className?: string;
}) {
  const start = midnight(now);
  const { today: t } = p;
  const u = t.usual;
  const day = u.same_weekday ? `a usual ${WEEKDAY_LONG[mondayFirst(new Date(start * 1000))]}` : "a usual day";
  const points: LinePoint[] = t.t.map((ts, i) => ({ t: ts + 150, v: t.w[i] }));
  const usual: LinePoint[] = u.w.map((w, i) => ({ t: start + i * u.slot + u.slot / 2, v: w }));
  const ahead = u.by_now > 0.01 ? (t.kwh - u.by_now) / u.by_now : null;
  return (
    <Card className={className}>
      <Head
        title={`Today against ${day}`}
        sub={
          p.days
            ? `${kWh(t.kwh)} so far${
                ahead == null
                  ? ""
                  : Math.abs(ahead) < 0.1
                    ? ", about as usual by now"
                    : `, ${Math.round(Math.abs(ahead) * 100)}% ${ahead > 0 ? "more" : "less"} than usual by now`
              }`
            : "Power through today"
        }
      >
        {t.by_midnight != null && (
          <Corner label="By midnight" sub={`usually ${kWh(u.kwh)}`}>
            {kWh(t.by_midnight)}
          </Corner>
        )}
      </Head>
      <div className="flex gap-4 text-xs text-ink-dim">
        <span className="flex items-center gap-1.5">
          <i className="h-[3px] w-3.5 rounded-[2px]" style={{ background: color }} />
          Today
        </span>
        {p.days > 0 && (
          <span className="flex items-center gap-1.5">
            <i className="w-3.5 border-t-2 border-dashed" style={{ borderColor: USUAL }} />
            Usual, from {u.days} {u.days === 1 ? "day" : "days"}
          </span>
        )}
      </div>
      <TimeLine
        label={`Power through today, against ${day}`}
        points={points}
        compare={p.days ? { points: usual, color: USUAL } : undefined}
        start={start}
        end={addDays(start, 1)}
        now={now}
        color={color}
        fill
        height={180}
        domain={[0, 100]}
        every={3}
        empty="No readings yet today."
        tip={(pt, other) => (
          <>
            <span className="font-medium text-ink">{hhmm(pt.t)}</span>
            {pt.v != null && <TooltipRow label="Today" value={kW(pt.v)} color={color} />}
            {other?.v != null && <TooltipRow label="Usual" value={kW(other.v)} color={USUAL} />}
          </>
        )}
      />
      {!p.days && <Muted>{LEARNING}</Muted>}
    </Card>
  );
}

/**
 * The next seven days: each one's usual use (its weekday's), with the range 8 in 10 of those days came within, and
 * what it's likely to cost; then the month so far and where it's heading.
 */
export function AheadCard({
  profile: p,
  color,
  rate,
  className,
}: {
  profile: HomeProfile;
  color: string;
  /** What a kWh has cost it lately ($), to put a price on what's ahead; null: not known. */
  rate: number | null;
  className?: string;
}) {
  const { hover: h, width, plot, bar } = useBarHover();
  const days = p.ahead;
  const known = days.filter((d) => d.kwh != null);
  const week = known.reduce((a, d) => a + (d.kwh ?? 0), 0);
  const top = Math.max(0.05, ...days.map((d) => d.high ?? d.kwh ?? 0)) * 1.1;
  const pc = (v: number) => `${(v / top) * 100}%`;
  const price = (kwh: number) => (rate != null ? money(kwh * rate) : null);
  return (
    <Card className={className}>
      <Head title="Coming up" sub="What the next seven days usually use, and the range most of them land in">
        {known.length > 0 && (
          <Corner label="Next 7 days" sub={price(week) ? `about ${price(week)}` : undefined}>
            {kWh(week)}
          </Corner>
        )}
      </Head>
      {known.length ? (
        <div className="flex flex-col gap-1.5">
          <div className="relative flex h-28 items-end gap-2 max-sm:gap-1" {...plot}>
            {days.map((d, i) => (
              <button
                key={d.date}
                type="button"
                {...bar(i)}
                aria-label={`${shortDay.format(parseYmd(d.date))}: ${d.kwh != null ? `about ${kWh(d.kwh)}` : "not known yet"}`}
                className={cn(
                  "relative flex h-full min-w-0 flex-1 cursor-pointer items-end justify-center border-0 bg-transparent p-0 transition-opacity duration-200",
                  h != null && h !== i && "opacity-45",
                )}
              >
                {d.low != null && d.high != null && d.high > d.low && (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 rounded-md"
                    style={{ bottom: pc(d.low), height: pc(d.high - d.low), background: alpha(color, 0.16) }}
                  />
                )}
                <span
                  className="bar-grow relative block w-3/5 rounded-[4px_4px_2px_2px]"
                  style={
                    {
                      height: pc(d.kwh ?? 0),
                      background: alpha(color, h === i ? 1 : 0.8),
                      "--i": i,
                    } as CSSProperties
                  }
                />
              </button>
            ))}
            {h != null && days[h].kwh != null && (
              <ChartTooltip left={((h + 0.5) / days.length) * 100} flip={h > days.length / 2} width={width}>
                <span className="font-medium text-ink">{shortDay.format(parseYmd(days[h].date))}</span>
                <TooltipRow label="Usually" value={kWh(days[h].kwh)} color={color} />
                {days[h].low != null && (
                  <TooltipRow label="Most days" value={`${kWh(days[h].low)} to ${kWh(days[h].high)}`} />
                )}
                {price(days[h].kwh!) && <TooltipRow label="About" value={price(days[h].kwh!)} />}
              </ChartTooltip>
            )}
          </div>
          <div className="flex gap-2 font-mono text-[11px] text-ink-faint max-sm:gap-1">
            {days.map((d) => (
              <span key={d.date} className="min-w-0 flex-1 text-center">
                {WEEKDAY_SHORT[mondayFirst(parseYmd(d.date))].slice(0, 2)}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <Muted>{LEARNING}</Muted>
      )}
      <div>
        <DataRow label="This month so far">{kWh(p.month.used)}</DataRow>
        <DataRow label="Likely by the end of the month" muted={p.month.likely == null} className="border-b-0">
          {p.month.likely == null
            ? "Needs a day of readings"
            : `${kWh(p.month.likely)}${price(p.month.likely) ? `, about ${price(p.month.likely)}` : ""}`}
        </DataRow>
      </div>
    </Card>
  );
}

/** When in the week it uses power: the average in each hour of each weekday, darker for more. */
export function WeekCard({
  profile: p,
  color,
  className,
}: {
  profile: HomeProfile;
  color: string;
  className?: string;
}) {
  const [hover, setHover] = useState<[day: number, hour: number] | null>(null);
  const [width, setWidth] = useState(0);
  const cells = p.week.flatMap((row) => row.map((v) => v ?? 0));
  const top = Math.max(0.001, ...cells);
  const dayTotals = p.week.map((row) =>
    row.some((v) => v != null) ? row.reduce<number>((a, v) => a + (v ?? 0), 0) : null,
  );
  const seen = dayTotals.filter((v): v is number => v != null);
  const hourTotals = Array.from({ length: 24 }, (_, hr) => p.week.reduce((a, row) => a + (row[hr] ?? 0), 0));
  const busiestDay = seen.length ? dayTotals.indexOf(Math.max(...seen)) : -1;
  const busiestHour = hourTotals.indexOf(Math.max(...hourTotals));
  const v = hover ? p.week[hover[0]][hover[1]] : null;
  return (
    <Card className={className}>
      <Head
        title="When it uses power"
        sub={
          seen.length && top > 0.001
            ? `Most on ${WEEKDAY_LONG[busiestDay]}s, and around ${hourLabel(busiestHour)}. The average hour of each day, over the last ${p.days} days`
            : "The average hour of each day of the week"
        }
      >
        {seen.length > 0 && (
          <Corner label="An average day">{kWh(seen.reduce((a, x) => a + x, 0) / seen.length)}</Corner>
        )}
      </Head>
      {p.days ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <div className="flex w-7 flex-none flex-col gap-[3px] font-mono text-[10.5px] text-ink-faint">
              {WEEKDAY_SHORT.map((d) => (
                <span key={d} className="flex h-4 items-center max-sm:h-3">
                  {d.slice(0, 2)}
                </span>
              ))}
            </div>
            <div
              className="relative grid min-w-0 flex-1 grid-cols-24 gap-[3px]"
              onPointerEnter={(e) => setWidth(e.currentTarget.offsetWidth)}
              onMouseLeave={() => setHover(null)}
            >
              {p.week.map((row, d) =>
                row.map((x, hr) => (
                  <span
                    key={`${d}-${hr}`}
                    onMouseEnter={() => setHover([d, hr])}
                    className={cn(
                      "h-4 rounded-[3px] transition-[box-shadow,opacity] duration-150 max-sm:h-3",
                      hover && (hover[0] !== d || hover[1] !== hr) && "opacity-70",
                      hover?.[0] === d && hover[1] === hr && "shadow-[0_0_0_2px_var(--color-ink)]",
                    )}
                    style={{
                      background: x ? alpha(color, 0.12 + 0.88 * Math.sqrt(x / top)) : "var(--color-track)",
                    }}
                  />
                )),
              )}
              {hover && (
                <ChartTooltip left={((hover[1] + 0.5) / 24) * 100} flip={hover[1] > 12} width={width}>
                  <span className="font-medium text-ink">
                    {WEEKDAY_LONG[hover[0]]}s, {hourLabel(hover[1])}
                  </span>
                  <TooltipRow label="On average" value={v == null ? "Not seen yet" : kWh(v)} color={color} />
                  {v != null && v > 0 && <TooltipRow label="As power" value={kW(v * 1000)} />}
                </ChartTooltip>
              )}
            </div>
          </div>
          <div className="flex gap-2 pl-9 font-mono text-[10.5px] text-ink-faint">
            <div className="grid min-w-0 flex-1 grid-cols-4">
              {[0, 6, 12, 18].map((hr) => (
                <span key={hr}>{hourLabel(hr)}</span>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <Muted>{LEARNING}</Muted>
      )}
    </Card>
  );
}

/** "2.3× usual". */
const times = (p: HomePeak) => (p.usual_w ? `${(p.w / p.usual_w).toFixed(1)}× usual` : null);

/** "Wed 1 Oct, 07:05". */
const when = (ts: number) => `${shortDay.format(new Date(ts * 1000))}, ${hhmm(ts)}`;

/**
 * What each device usually peaks at when it's used, and the most it drew in the last 30 days; the days one drew well
 * over that (spikes); today's highest; and what's always on.
 */
export function SpikesCard({
  profile: p,
  devices,
  colors,
  standby,
  className,
}: {
  profile: HomeProfile;
  devices: HomeDevice[];
  colors: Map<number, string>;
  /** What's always on (W) and what it comes to a year ($), if it's known. */
  standby?: { w: number; yearly: number } | null;
  className?: string;
}) {
  const name = (id: number) => devices.find((d) => d.id === id)?.name ?? "A device";
  const many = devices.length > 1;
  const today = p.peak_today;
  const top = Math.max(1, ...p.peaks.map((x) => x.max.w));
  return (
    <Card className={className}>
      <Head
        title="Power spikes"
        sub="What it peaks at when it's used, and any day it drew far more, over the last 30 days"
      >
        {today && (
          <Corner label="Highest today" sub={`at ${hhmm(today.ts)}${many ? `, ${name(today.device)}` : ""}`}>
            {kW(today.w)}
          </Corner>
        )}
      </Head>
      {p.peaks.length ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {p.peaks.map((x) => {
            const c = colors.get(x.device) ?? "var(--color-bar)";
            return (
              <li key={x.device} className="flex flex-col gap-1.5">
                <span className="flex items-baseline gap-2 text-[13.5px] tabular-nums">
                  <span className="min-w-0 flex-1 truncate text-ink">{many ? name(x.device) : "When it's used"}</span>
                  <span className="text-ink-faint">peaks at</span>
                  <span className="font-medium text-ink">{kW(x.usual_w)}</span>
                </span>
                {/* Its usual peak, solid, and the most it drew, the faint rest of the bar. */}
                <span className="relative h-1.5 rounded-full bg-fg/6">
                  <span
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${(x.max.w / top) * 100}%`, background: alpha(c, 0.3) }}
                  />
                  <span
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${(x.usual_w / top) * 100}%`, background: c }}
                  />
                </span>
                <span className="text-xs text-ink-faint tabular-nums">
                  Most {kW(x.max.w)}, {when(x.max.ts)} · used on {x.days} {x.days === 1 ? "day" : "days"}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <Muted>
          Peaks are kept from now on, from each reading of what it's drawing: they show here as they come in.
        </Muted>
      )}
      {p.peaks.length > 0 &&
        (p.spikes.length ? (
          <div className="flex flex-col">
            <span className="pb-1 text-xs text-ink-faint">Spikes: half as much again as usual, or more</span>
            {p.spikes.map((x) => (
              <div
                key={`${x.device}-${x.ts}`}
                className="flex items-center gap-3 border-t border-line-subtle py-2 text-[13px] tabular-nums first:border-t-0"
              >
                {many && <Swatch color={colors.get(x.device) ?? "var(--color-bar)"} size={9} />}
                <span className="min-w-0 flex-1 truncate text-ink-muted">
                  {many ? `${name(x.device)}, ` : ""}
                  {when(x.ts)}
                </span>
                <Pill tone="bad" size="sm">
                  {times(x)}
                </Pill>
                <span className="w-16 text-right font-medium text-ink">{kW(x.w)}</span>
              </div>
            ))}
          </div>
        ) : (
          <Muted>No spikes: nothing drew much more than it usually does.</Muted>
        ))}
      {standby && standby.w >= 0.5 && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-fg/4 px-4 py-3 text-[13px]">
          <span className="text-ink-muted">Always on</span>
          <span className="text-right text-ink tabular-nums">
            {standby.w < 10 ? standby.w.toFixed(1) : Math.round(standby.w)} W
            <span className="text-ink-faint"> · about {money(standby.yearly)} a year</span>
          </span>
        </div>
      )}
    </Card>
  );
}

/** What the device says about itself (its Wi-Fi signal, how long it's been on, its firmware), and when it was read. */
export function AboutCard({
  device,
  kindLabel,
  className,
}: {
  device: HomeDevice;
  kindLabel: string;
  className?: string;
}) {
  const info = Object.entries(device.now?.info ?? {});
  const rows: [string, string][] = [
    ["What it is", kindLabel],
    ...(device.model ? ([["Model", device.model]] as [string, string][]) : []),
    ...info,
    ["Last read", device.now ? `${hhmm(device.now.at)}${device.now.online ? "" : ", offline"}` : DASH],
  ];
  return (
    <Card className={className}>
      <TitleBlock title="About it" sub="What it reports about itself" />
      <div className="grid grid-cols-2 gap-x-8 max-md:grid-cols-1">
        {rows.map(([label, value]) => (
          <DataRow key={label} label={label}>
            {value}
          </DataRow>
        ))}
      </div>
    </Card>
  );
}
