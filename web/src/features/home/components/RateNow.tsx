import { hhmm } from "~/features/common/formatting/utils/date";
import { centsShort, DASH } from "~/features/common/formatting/utils/number";
import type { RateRun } from "~/features/common/tariffs/utils";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { addDays, midnight } from "~/features/common/time/utils";
import { Card } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { roomOf, rowsFor } from "~/features/common/widgets/room";
import type { Settings } from "~/features/common/widgets/types";
import { RateStrip, rateAt } from "~/features/home/components/RateStrip";
import { useRates } from "~/features/home/hooks";

/** What the card shows, given room for it. */
export type RateShow = {
  /** The day's rates as steps, the rate now marked. */
  day: boolean;
  /** When the rate next changes, and to what. */
  next: boolean;
  /** The cheapest and dearest left today, given room. */
  range: boolean;
};

export const rateShow = (settings: Settings): RateShow => ({
  day: settings.day !== false,
  next: settings.next !== false,
  range: settings.range !== false,
});
const ALL = rateShow({});

const HEAD = 28 + 12;
const FIGURE = 44 + 12;
const NEXT = 16 + 12;
const DAY = 34 + 12;
const RANGE = 1 + 12 + 40;

/** The most rows the card can use for what it shows. */
export const rateRows = (show: RateShow, w: number) =>
  rowsFor(HEAD + FIGURE + (show.next ? NEXT : 0) + (show.day ? DAY : 0) + (show.range && w >= 3 ? RANGE : 0));

/** The next stretch at a different rate (half a cent or more), after `now`. */
function nextChange(runs: RateRun[], now: number): RateRun | null {
  const cur = rateAt(runs, now);
  if (!cur) return null;
  return runs.find((r) => r.from >= cur.to && Math.abs(r.rate - cur.rate) >= 0.005) ?? null;
}

/** The cheapest and dearest stretches left today (from now). */
function leftToday(runs: RateRun[], now: number) {
  const left = runs.filter((r) => r.to > now);
  if (!left.length) return null;
  const lo = left.reduce((a, r) => (r.rate < a.rate ? r : a), left[0]);
  const hi = left.reduce((a, r) => (r.rate > a.rate ? r : a), left[0]);
  return { lo, hi };
}

/** The day's rates as small steps, as dear as they're tall, the rate now marked. For a card too small for the strip. */
function Steps({ runs, start, now }: { runs: RateRun[]; start: number; now: number }) {
  const end = addDays(start, 1);
  const hi = Math.max(0.01, ...runs.map((r) => r.rate));
  const left = (t: number) => ((Math.max(start, Math.min(end, t)) - start) / (end - start)) * 100;
  return (
    <div className="relative h-4" role="img" aria-label="Rates through the day">
      {runs.map((r) => (
        <span
          key={r.from}
          className="absolute bottom-0 rounded-[3px]"
          style={{
            left: `calc(${left(r.from)}% + 1px)`,
            width: `calc(${left(r.to) - left(r.from)}% - 2px)`,
            height: `${30 + (Math.max(0, r.rate) / hi) * 70}%`,
            background: alpha(r.color, 0.5),
          }}
        />
      ))}
      <span
        className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-ink"
        style={{ left: `${left(now)}%` }}
      />
    </div>
  );
}

/**
 * What grid power costs now, for a dashboard, fitted to its size: the rate and its name, when it next changes and to
 * what, the day's rates as steps with now marked, and the cheapest and dearest left today. From the rates in Settings →
 * Bills, or on Amber its prices for each 5 or 30 minutes. The card takes a glow of the rate's colour.
 */
export function RateNow({ now, w = 3, h = 2, show = ALL }: { now: number; w?: number; h?: number; show?: RateShow }) {
  const start = midnight(now);
  const runs = useRates(start);
  const { wide, tall } = roomOf(w, h);
  const rate = rateAt(runs, now);
  const next = runs ? nextChange(runs, now) : null;
  const range = runs ? leftToday(runs, now) : null;
  const color = rate?.color ?? COLOR.import;
  const many = (runs?.length ?? 0) > 1;
  return (
    <Card
      aria-label="What power costs now"
      className="h-full gap-3 overflow-hidden p-5 max-sm:p-4"
      style={{ backgroundImage: `radial-gradient(circle at 0% 0%, ${alpha(color, 0.18)}, transparent 65%)` }}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="flex size-7 flex-none items-center justify-center rounded-[9px]"
          style={{ background: alpha(color, 0.16), color }}
        >
          <Icon name="dollar" size={15} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink-muted">Power costs now</span>
        {rate && wide !== "xs" && (
          <span className="truncate text-xs" style={{ color }}>
            {rate.name}
          </span>
        )}
      </div>
      <span className="flex items-baseline gap-1 font-light text-ink tabular-nums">
        <span className="text-[40px] leading-11 tracking-[-1.5px] max-sm:text-[32px] max-sm:leading-9">
          {rate ? centsShort(rate.rate) : DASH}
        </span>
        {rate && <span className="text-[15px] font-normal text-ink-faint">/kWh</span>}
      </span>
      {show.next && many && (
        <span className="truncate text-xs text-ink-faint tabular-nums">
          {next
            ? `${rate && next.name !== rate.name ? `${next.name} ` : "Then "}${centsShort(next.rate)} from ${hhmm(next.from)}`
            : rate
              ? `Until ${hhmm(rate.to)}`
              : ""}
        </span>
      )}
      {show.day &&
        runs &&
        many &&
        (tall === "short" || wide === "xs" ? (
          tall !== "short" && <Steps runs={runs} start={start} now={now} />
        ) : (
          <RateStrip runs={runs} start={start} end={addDays(start, 1)} now={now} />
        ))}
      {show.range && range && many && tall === "tall" && w >= 3 && (
        <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-line-subtle pt-3">
          <div className="flex min-w-0 flex-col">
            <dt className="truncate text-[11.5px] text-ink-faint">Cheapest left today</dt>
            <dd className="text-[17px] font-light tabular-nums">{centsShort(range.lo.rate)}</dd>
            <dd className="truncate text-[11.5px] text-ink-faint">from {hhmm(Math.max(now, range.lo.from))}</dd>
          </div>
          <div className="flex min-w-0 flex-col">
            <dt className="truncate text-[11.5px] text-ink-faint">Dearest left today</dt>
            <dd className="text-[17px] font-light tabular-nums">{centsShort(range.hi.rate)}</dd>
            <dd className="truncate text-[11.5px] text-ink-faint">from {hhmm(Math.max(now, range.hi.from))}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}
