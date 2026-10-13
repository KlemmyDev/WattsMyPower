import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, plural } from "~/features/common/formatting/utils/number";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { historyQuery } from "~/features/common/readings/api";
import type { HistorySeries } from "~/features/common/readings/types";
import { useNow } from "~/features/common/time/hooks";
import { addDays, dateKey, midnight, partsOf, siteTime } from "~/features/common/time/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { EmptyState } from "~/features/common/ui/components/EmptyState";
import { Icon } from "~/features/common/ui/components/Icon";
import { Figure } from "~/features/common/ui/components/Live";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { parts } from "~/features/common/widgets/parts";
import { exportCsvUrl, statsQuery } from "~/features/history/api";
import { SOLAR } from "~/features/solar/components/parts";
import { SolarSection } from "~/features/solar/components/sections/SolarSection";
import { READING_FIELDS, readingColumns, ReadingsTable } from "~/features/solar/components/sections/ReadingsTable";
import { ScrubChart } from "~/features/solar/components/sections/StringsChart";
import { energyOf, lastIndex, nearestIndex } from "~/features/solar/utils/sections";

/** Rows shown around the chosen moment: an hour of readings. */
const WINDOW = 12;

/**
 * Solar › Readings: any day's five-minute readings. A chart of the day's solar to pick a moment on, and the table around
 * that moment (or the whole day), ready to download as CSV.
 */
export function SolarReadingsPage() {
  const now = useNow(60_000);
  const today = midnight(now);
  const [picked, setPicked] = useState<number | null>(null);
  const day = picked != null && picked < today ? picked : today;
  const [chosen, setChosen] = useState<{ day: number; t: number } | null>(null);
  const [all, setAll] = useState(false);
  const s = useSystem();
  const isToday = day === today;
  const fields = s?.pv2 ? READING_FIELDS : READING_FIELDS.filter((f) => f !== "pv1_power" && f !== "pv2_power");
  const q = useQuery(historyQuery({ start: day, end: addDays(day, 1), points: 288, fields, live: isToday }));
  const first = useQuery(statsQuery).data?.history_from ?? null;
  const series = q.data?.series;
  const go = (d: number) => {
    setPicked(d);
    setChosen(null);
  };

  const t = series?.t ?? [];
  const latest = lastIndex(series?.pv_power);
  const p = partsOf(day);
  // The moment the table's around: the one chosen on this day, else the latest reading today, else midday.
  const at =
    chosen?.day === day ? chosen.t : isToday && latest != null ? t[latest] : siteTime(p.year, p.month, p.day, 12);
  const i = series ? nearestIndex(t, at, undefined, Infinity) : null;
  const choose = (x: number | null) => x != null && setChosen({ day, t: x });
  const empty = series && !hasReadings(series);

  return (
    <SolarSection
      section="readings"
      sub={series ? subLine(series, isToday) : "Every five minutes, any day"}
      action={<DayPicker day={day} today={today} first={first} onDay={go} />}
    >
      {!series ? (
        <>
          <Skeleton className="h-[300px] rounded-3xl" />
          <Skeleton className="h-[560px] rounded-3xl" />
        </>
      ) : empty ? (
        <EmptyState icon="database" title="No readings this day">
          The dashboard wasn't recording on {shortDay.format(day * 1000)}, so there's nothing to show. Pick another day.
        </EmptyState>
      ) : (
        <>
          <PickATime series={series} day={day} at={at} i={i} now={isToday ? now : undefined} onAt={choose} />
          <TableCard
            series={series}
            day={day}
            i={i}
            all={all}
            onAll={() => setAll(!all)}
            onChoose={choose}
            columns={readingColumns(series, s)}
          />
        </>
      )}
    </SolarSection>
  );
}

/** Whether a day has any readings at all (the series carries empty rows where readings stopped). */
const hasReadings = (series: HistorySeries) =>
  Object.entries(series).some(([k, v]) => k !== "t" && v.some((x) => x != null));

/** "18.4 kWh of solar · 288 readings", or "so far" for today. */
function subLine(series: HistorySeries, isToday: boolean) {
  const n = series.t.filter((_, i) => series.pv_power?.[i] != null).length;
  const made = energyOf(series.t, series.pv_power ?? []);
  return [made != null ? `${kWh(made)} of solar${isToday ? " so far" : ""}` : null, `${n} ${plural(n, "reading")}`]
    .filter(Boolean)
    .join(" · ");
}

/** The day being read: back a day (not before the history starts), the date, on a day (not past today), and Today. */
function DayPicker({
  day,
  today,
  first,
  onDay,
}: {
  day: number;
  today: number;
  first: number | null;
  onDay: (d: number) => void;
}) {
  const isToday = day === today;
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="round"
        aria-label="The day before"
        disabled={first != null && day <= midnight(first)}
        onClick={() => onDay(addDays(day, -1))}
      >
        <Icon name="chevL" size={16} />
      </Button>
      <span className="min-w-28 text-center text-sm font-medium tabular-nums" aria-live="polite">
        {isToday ? "Today" : shortDay.format(day * 1000)}
      </span>
      <Button variant="round" aria-label="The day after" disabled={isToday} onClick={() => onDay(addDays(day, 1))}>
        <Icon name="chevR" size={16} />
      </Button>
      {!isToday && (
        <Button variant="chip" onClick={() => onDay(today)}>
          Today
        </Button>
      )}
    </div>
  );
}

/**
 * The day's solar, small, to choose a moment on: press and drag along it (or use the arrow keys) and the table below
 * moves there. The moment's solar shows in the corner.
 */
function PickATime({
  series,
  day,
  at,
  i,
  now,
  onAt,
}: {
  series: HistorySeries;
  day: number;
  at: number;
  i: number | null;
  now?: number;
  onAt: (t: number | null) => void;
}) {
  const pv = series.pv_power ?? [];
  const [value, unit] = parts(kW(i != null ? pv[i] : null));
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <TitleBlock
          className="min-w-0 flex-1"
          title="Pick a time"
          sub="Drag along the day, and the readings below follow"
        />
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="text-xs text-ink-muted tabular-nums">Solar at {i != null ? hhmm(series.t[i]) : DASH}</span>
          <Figure value={value} unit={unit} />
        </div>
      </div>
      <ScrubChart
        mode="pick"
        lines={[{ key: "pv", color: SOLAR, t: series.t, v: pv, fill: true }]}
        start={day}
        end={addDays(day, 1)}
        at={at}
        onAt={onAt}
        now={now}
        height={120}
        every={3}
        axis={(v) => kW(v)}
        label="Pick a time of day"
        describe={(m) => {
          const k = nearestIndex(series.t, m, pv);
          return `${hhmm(m)}, solar ${kW(k != null ? pv[k] : null)}`;
        }}
      />
    </Card>
  );
}

/**
 * The readings table in its card: an hour around the chosen moment with Earlier and Later to move along, or the whole
 * day; and the day as CSV, every reading as the dashboard keeps it (5-minute averages, all fields).
 */
function TableCard({
  series,
  day,
  i,
  all,
  onAll,
  onChoose,
  columns,
}: {
  series: HistorySeries;
  day: number;
  i: number | null;
  all: boolean;
  onAll: () => void;
  onChoose: (t: number) => void;
  columns: ReturnType<typeof readingColumns>;
}) {
  const n = series.t.length;
  const mid = i ?? 0;
  const from = all ? 0 : Math.max(0, Math.min(n - WINDOW, mid - WINDOW / 2));
  const to = all ? n - 1 : Math.min(n - 1, from + WINDOW - 1);
  const move = (by: number) => onChoose(series.t[Math.max(0, Math.min(n - 1, mid + by))]);
  const signedCols = columns.some((c) => c.key === "battery_power" || c.key === "grid_power");
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <TitleBlock
          className="min-w-0 flex-1 basis-60"
          title="Every reading"
          sub={
            all ? "The whole day, every 5 minutes" : `${hhmm(series.t[from])} to ${hhmm(series.t[to])}, every 5 minutes`
          }
        />
        <a
          href={exportCsvUrl(day, addDays(day, 1), true)}
          download={`solar-${dateKey(day)}.csv`}
          className="inline-flex items-center gap-2 text-[13px] font-medium text-ink-muted no-underline hover:text-ink"
        >
          <Icon name="download" size={16} />
          Download CSV
        </a>
      </div>
      <ReadingsTable series={series} columns={columns} from={from} to={to} chosen={i} onChoose={onChoose} />
      <div className="flex flex-wrap items-center gap-2">
        {!all && (
          <>
            <Button variant="chip" disabled={from === 0} onClick={() => move(-WINDOW)}>
              <Icon name="chevL" size={14} />
              Earlier
            </Button>
            <Button variant="chip" disabled={to >= n - 1} onClick={() => move(WINDOW)}>
              Later
              <Icon name="chevR" size={14} />
            </Button>
          </>
        )}
        <Button variant="chip" aria-pressed={all} onClick={onAll}>
          {all ? "Show an hour" : "Show all"}
        </Button>
      </div>
      {signedCols && (
        <div className="text-xs text-pretty text-ink-faint">
          Battery is + while it runs the house and − while it charges. Grid is + bought and − sent out.
        </div>
      )}
    </Card>
  );
}
