import { useId, type ReactNode } from "react";
import type { Forecast } from "~/features/common/weather/types";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { Card, CardHeader } from "~/features/common/ui/components/Card";
import { cn } from "~/features/common/ui/utils";
import { batteryOutlook, type FullInfo } from "~/features/overview/utils/batteryOutlook";
import { batteryState, reserveOf, type BatteryState } from "~/features/common/energy/utils";
import { DASH, kWh, pct } from "~/features/common/formatting/utils/number";
import { ARC_LARGE, BatteryArc } from "~/features/overview/components/BatteryArc";
import { BatteryHistory } from "~/features/overview/components/BatteryHistory";
import { BatteryPower } from "~/features/overview/components/BatteryPower";
import { BatteryModeLine } from "~/features/battery/components/BatteryModeLine";
import { useBatteryMode } from "~/features/battery/hooks";
import { useTween } from "~/features/common/ui/hooks/useTween";
import { roomOf } from "~/features/common/widgets/room";

/** The ring at its largest (px). */
const RING = 168;
/** The header's height (the mode pill's) and the gap under it, and the outlook's under a ring (px). */
const HEAD = 34 + 12;
const UNDER = 52 + 12;

/**
 * The battery's state of charge ring, time to full (or to reserve), what it's set to do, and the last six hours, fitted
 * to its size on the grid (`w` columns by `h` rows) rather than stretched to it. At its smallest (2 × 2) it's the ring
 * alone, with the charge and what it's doing in it. Wider, the outlook comes in beside it; taller, a header with what
 * it's set to do (and the shortcuts, given room), then the last six hours (beside it in a short wide one, under it in a
 * tall one). Larger still, the figures behind it: what it can still give, what went in and out today, its reserve,
 * health and temperature.
 */
export function BatteryCard({
  p,
  s,
  f,
  now,
  w = 6,
  h = 7,
  title = "Battery",
  shortcuts = true,
  className,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  now: number;
  /** Its size on the grid, in columns and rows. */
  w?: number;
  h?: number;
  title?: string;
  /** Whether to offer the battery shortcuts, given room for them. */
  shortcuts?: boolean;
  className?: string;
}) {
  const id = useId();
  const st = batteryState(p?.battery_power);
  const mode = useBatteryMode();
  const fi = p ? batteryOutlook(p, s, f, now, mode) : null;
  const { wide, tall, inner } = roomOf(w, h);
  const xs = wide === "xs";
  // The ring alone at the smallest; over its outlook where it's narrow; beside it otherwise.
  const alone = xs && tall === "short";
  const stacked = xs || (w === 3 && h >= 4);
  const header = tall !== "short" && !(xs && tall === "mid");
  const big = tall === "tall" && (wide === "md" || wide === "lg");
  const keys = shortcuts && w >= 5;
  const chart = tall === "tall" ? "under" : w >= 7 ? "side" : null;
  const facts =
    tall === "short"
      ? w >= 10 && { side: true, n: 2, cols: 2 }
      : tall === "mid"
        ? w >= 10 && { side: true, n: 4, cols: 2 }
        : wide === "lg"
          ? { side: true, n: w >= 10 ? 6 : 4, cols: w >= 10 ? 3 : 2 }
          : wide === "md"
            ? h >= 7 && { side: false, n: w >= 6 ? 4 : 3, cols: w >= 6 ? 4 : 3 }
            : w === 4 && h >= 8 && { side: false, n: 2, cols: 2 };
  // The height the ring has: the card's, less the header and the outlook under it; tall, it shares it with the chart.
  const room = inner - (header ? HEAD : 0) - (stacked && !alone ? UNDER : 0);
  const ring = Math.max(72, Math.min(RING, tall === "tall" && stacked ? room / 2 : room));
  return (
    <Card
      aria-labelledby={id}
      className={cn("@container relative h-full gap-3 overflow-hidden p-5 max-sm:p-4", className)}
    >
      {header ? (
        big ? (
          <CardHeader
            title={title}
            id={id}
            className="h-[34px]"
            action={<BatteryModeLine now={now} shortcuts={shortcuts} className="min-w-0 rounded-full" />}
          />
        ) : (
          <div className="flex h-[34px] min-w-0 items-center gap-3">
            <span id={id} className="flex-none truncate font-display text-base font-bold">
              {title}
            </span>
            {!xs && (
              <BatteryModeLine
                now={now}
                shortcuts={keys}
                className={cn("ml-auto min-w-0 rounded-full", !keys && "pr-3.5")}
              />
            )}
          </div>
        )
      ) : (
        <span id={id} className="sr-only">
          {title}
        </span>
      )}
      <div
        className={cn(
          "relative z-1 flex min-h-0 min-w-0",
          stacked ? "flex-col items-center justify-center gap-3" : "items-center gap-5",
          // with nothing under it, it takes the card's height, the ring and outlook in its middle
          chart === "under" || (facts && !facts.side) ? "flex-none" : "flex-1",
        )}
      >
        <Ring p={p} s={s} st={st} px={ring} cap={stacked ? 100 : 46} />
        {!alone && fi && (
          <Outlook
            fi={fi}
            warn={st === "discharge"}
            center={stacked}
            large={big}
            lines={stacked ? 0 : tall === "short" ? 2 : tall === "mid" ? 3 : 4}
            className={chart === "side" || facts ? "max-w-[17rem]" : undefined}
          />
        )}
        {facts && facts.side && (
          <Facts
            p={p}
            s={s}
            n={facts.n}
            cols={facts.cols}
            className={chart === "side" ? "w-[15rem] flex-none" : "ml-auto max-w-[30rem] min-w-[14rem] flex-1"}
          />
        )}
        {chart === "side" && (
          <BatteryHistory
            end={p ? p.ts + 1 : null}
            s={s}
            hours={wide === "lg" ? 12 : 6}
            className="mt-0 h-auto min-w-0 flex-1 self-stretch"
          />
        )}
      </div>
      {facts && !facts.side && <Facts p={p} s={s} n={facts.n} cols={facts.cols} />}
      {chart === "under" && (
        // edge to edge along the bottom, its labels padded in, taking what height is left
        <BatteryHistory
          end={p ? p.ts + 1 : null}
          s={s}
          hours={wide === "lg" ? 12 : 6}
          className="-mx-5 -mb-5 h-auto min-h-0 flex-1 max-sm:-mx-4 max-sm:-mb-4"
          inset="px-5 max-sm:px-4"
        />
      )}
    </Card>
  );
}

/**
 * What it'll do next: the time to full (or to reserve, or what it's set to), with a sentence on it given `lines`.
 * Where its column's narrow, the eyebrow and headline say it in a word or two, and the sentence is left out.
 */
function Outlook({
  fi,
  warn,
  center,
  large,
  lines,
  className,
}: {
  fi: FullInfo;
  warn: boolean;
  center: boolean;
  large: boolean;
  /** How many lines its sentence may take (2 to 4); with none, it's left out. */
  lines: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "@container flex min-w-0 flex-col gap-1",
        center ? "w-full items-center text-center" : "flex-1",
        className,
      )}
    >
      {/* keyed, so a change (to full, to reserve, on standby…) fades in rather than snapping */}
      <span
        key={fi.eyebrow}
        className={cn(
          "w-full animate-fade truncate text-[13px] leading-5 font-medium",
          warn ? "text-warn" : "text-ink-muted",
        )}
      >
        <span className="@max-[13rem]:hidden">{fi.eyebrow}</span>
        <span className="@min-[13rem]:hidden">{fi.tag}</span>
      </span>
      <span
        key={fi.headline}
        title={fi.headline}
        className={cn(
          "w-full animate-fade truncate font-semibold tracking-[-0.04em] tabular-nums",
          center
            ? "text-xl leading-7"
            : large
              ? "text-[26px] leading-8 @min-[13rem]:text-[34px] @min-[13rem]:leading-10"
              : "text-[22px] leading-7 @min-[15rem]:text-[28px] @min-[15rem]:leading-9",
          warn && "text-warn",
        )}
      >
        <span className="@max-[13rem]:hidden">{fi.headline}</span>
        <span className="@min-[13rem]:hidden">{fi.brief}</span>
      </span>
      {lines > 0 && fi.detail.trim() && (
        <p
          title={fi.detail}
          className={cn(
            "m-0 text-[13px] leading-5 text-pretty text-ink-muted @max-[13rem]:hidden",
            lines > 3 ? "line-clamp-4" : lines > 2 ? "line-clamp-3" : "line-clamp-2",
          )}
        >
          {fi.detail}
        </p>
      )}
    </div>
  );
}

/**
 * The battery's ring (see BatteryArc), `px` across at most and no more than `cap` % of the card's width, with the
 * charge in the middle gliding to each reading, what it holds where there's room, and what it's doing; the dark dot
 * marks the backup reserve. What's in it scales with it.
 */
function Ring({
  p,
  s,
  st,
  px,
  cap,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  st: BatteryState | null;
  px: number;
  cap: number;
}) {
  const kwh = s?.battery_kwh || 0;
  const soc = p?.battery_soc ?? null;
  const shown = useTween(soc);
  const reserve = reserveOf(s) / 100;
  return (
    <div
      className="@container relative aspect-square flex-none"
      style={{ width: `min(${Math.round(px)}px, ${cap}cqw)` }}
      title={`Backup reserve ${pct(reserve * 100)}`}
    >
      {p && (
        <>
          <BatteryArc frac={(soc || 0) / 100} st={st} size={ARC_LARGE} reserve={reserve} />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-[2.5cqw] pt-[1.5cqw]">
            <div className="text-[31cqw] leading-none font-medium tracking-[-0.06em] tabular-nums">
              {shown == null ? "—" : Math.round(shown)}
              <span className="ml-0.5 text-[13cqw] font-normal tracking-normal text-ink-muted">%</span>
            </div>
            {kwh > 0 && soc != null && (
              <div className="text-xs font-medium text-ink-muted tabular-nums @max-[8.5rem]:hidden">
                {((soc / 100) * kwh).toFixed(1)} of {kwh} kWh
              </div>
            )}
            <BatteryPower st={st} w={p.battery_power} className="@max-[6.5rem]:text-[11px]" />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The figures behind the ring, as many as `n` (`cols` to a row): what it can still give above its reserve, what went
 * in and out today, the reserve, and its health and temperature where the inverter reports them.
 */
function Facts({
  p,
  s,
  n,
  cols,
  className,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  n: number;
  cols: number;
  className?: string;
}) {
  const cap = s?.battery_kwh;
  const soc = p?.battery_soc;
  const reserve = reserveOf(s);
  const all: [string, ReactNode][] = [
    ["Usable now", soc != null && cap ? kWh(Math.max(0, ((soc - reserve) / 100) * cap)) : DASH],
    ["Charged today", kWh(p?.daily_charge)],
    ["Used today", kWh(p?.daily_discharge)],
    ["Reserve", pct(reserve)],
  ];
  if (p?.battery_soh != null) all.push(["Health", pct(p.battery_soh)]);
  if (p?.battery_temp != null) all.push(["Temperature", `${Math.round(p.battery_temp)}°C`]);
  return (
    <div
      className={cn("grid min-w-0 gap-2", className)}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {all.slice(0, n).map(([label, value]) => (
        <div key={label} className="flex min-w-0 flex-col gap-0.5 rounded-2xl bg-fg/4 px-3 py-2">
          <span className="truncate text-[11.5px] leading-4 text-ink-muted">{label}</span>
          <span className="truncate text-[17px] leading-6 font-light tabular-nums">{value}</span>
        </div>
      ))}
    </div>
  );
}
