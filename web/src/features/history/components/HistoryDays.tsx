import type { Ref } from "react";
import { plural } from "~/features/common/formatting/utils/number";
import { heatColor } from "~/features/common/theme/utils/colors";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { MonthCalendar, YearHeatmap } from "~/features/history/components/YearCalendar";
import { METRIC_KEYS, type Metric } from "~/features/history/utils/search";
import { SKIES, TABS, type Cell, type Sky } from "~/features/history/utils/year";

/**
 * Every day of the year as a heatmap (a month at a time on phones), coloured by what you pick: solar, self-sufficiency,
 * the grid, the saving or the weather. Choosing a day opens it hour by hour.
 */
export function HistoryDays({
  cells,
  lead,
  selected,
  onSelect,
  onShow,
  metric,
  onMetric,
  days,
  greatDays,
  skies,
  weatherKnown,
  ref,
}: {
  cells: Cell[];
  /** Blank cells before 1 January, so weeks run Monday to Sunday. */
  lead: number;
  selected: number;
  /** Choose a day; `onShow` also brings its detail into view (from the phone calendar, under the card). */
  onSelect: (ts: number) => void;
  onShow: (ts: number) => void;
  metric: Metric;
  onMetric: (m: Metric) => void;
  /** Days with readings, and whole days at least 90% self-sufficient. */
  days: number;
  greatDays: number;
  /** How many days of each kind of weather, once the weather's loaded. */
  skies: Record<Sky, number> | null;
  weatherKnown: number;
  ref?: Ref<HTMLElement>;
}) {
  const weather = metric === "weather";
  const { label, color } = TABS[metric];
  const perDay = weather ? "The weather each day" : `${label} each day`;
  return (
    <Card ref={ref} aria-labelledby="h-days" className="scroll-mt-28">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <TitleBlock
          id="h-days"
          title="Day by day"
          sub={
            days
              ? `${days} ${plural(days, "day")} recorded · ${greatDays} at 90% self-sufficient or more`
              : "Days fill in as your system records them"
          }
        />
        <div className="max-w-full [scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden">
          <Segmented
            label="Colour days by"
            role="tablist"
            options={METRIC_KEYS.map((k) => ({
              value: k,
              label: (
                <>
                  <i className="size-[7px] rounded-full" style={{ background: TABS[k].color }} />
                  {TABS[k].label}
                </>
              ),
            }))}
            value={metric}
            onChange={onMetric}
            buttonClassName="px-3 py-1.5 text-[13px]"
          />
        </div>
      </div>
      {weather && skies && weatherKnown < days / 2 && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px] text-pretty text-ink-muted">
          <span>
            {weatherKnown
              ? `You have weather for ${weatherKnown} of the ${days} days with readings.`
              : "No weather saved for these days yet."}{" "}
            Open-Meteo can fill in past weather.
          </span>
          <ButtonLink to="/integrations/weather" variant="link" size="sm">
            Fill in past weather
          </ButtonLink>
        </div>
      )}
      <div className="flex flex-col gap-3">
        <YearHeatmap cells={cells} lead={lead} selected={selected} onSelect={onSelect} />
        <MonthCalendar cells={cells} selected={selected} onSelect={onShow} sub={`${perDay} · select a day`} />
        <div className="ml-10 flex flex-wrap items-center justify-between gap-4 text-xs text-ink-faint max-md:ml-0 max-md:justify-center">
          <span className="max-md:hidden">{perDay} · select a day to see it hour by hour</span>
          {weather ? (
            <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-1.5 max-md:justify-center">
              {SKIES.map((s) => (
                <span key={s.key} className="flex items-center gap-1.5 tabular-nums">
                  <i className="size-2.5 rounded-[3px]" style={{ background: s.fill }} />
                  {s.label}
                  {skies ? ` · ${skies[s.key]}` : ""}
                </span>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              Less
              {[0, 0.33, 0.66, 1].map((v) => (
                <i key={v} className="size-2.5 rounded-[3px]" style={{ background: heatColor(color, v) }} />
              ))}
              More
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
