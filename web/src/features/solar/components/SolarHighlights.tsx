import { Link } from "@tanstack/react-router";
import { hhmm, hourLabel } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, signedPct } from "~/features/common/formatting/utils/number";
import type { HistorySeries } from "~/features/common/readings/types";
import { hourOf } from "~/features/common/time/utils";
import { Icon } from "~/features/common/ui/components/Icon";
import { SECTIONS, type SectionKey } from "~/features/solar/components/sections/SolarSection";
import type { solarToday } from "~/features/solar/utils";

type Today = ReturnType<typeof solarToday>;

/** The hour that made the most so far today, and how much. */
function bestHour(series: HistorySeries | undefined): { start: number; kwh: number } | null {
  const byHour = new Map<number, number>();
  const t = series?.t ?? [];
  const v = series?.pv_power ?? [];
  for (let i = 0; i < t.length - 1; i++) {
    const w = v[i];
    if (w == null) continue;
    const hour = Math.floor(t[i] / 3600) * 3600;
    byHour.set(hour, (byHour.get(hour) ?? 0) + (w * (t[i + 1] - t[i])) / 3_600_000);
  }
  let best: { start: number; kwh: number } | null = null;
  for (const [start, kwh] of byHour) if (kwh > 0.05 && (!best || kwh > best.kwh)) best = { start, kwh };
  return best;
}

/**
 * Four figures that sum the day up, each a way into the section that explains it: the day's peak (into the strings),
 * its best hour (into the readings), how it compares with a usual day (into performance) and with this morning's
 * forecast (into the forecast).
 */
export function SolarHighlights({
  today,
  series,
  usual,
}: {
  today: Today;
  series: HistorySeries | undefined;
  usual: number | null;
}) {
  const best = bestHour(series);
  const day = today.heading ?? today.made;
  const vsUsual = day != null && usual ? day / usual - 1 : null;
  const cards: { to: SectionKey; figure: string; label: string; sub: string }[] = [
    {
      to: "strings",
      figure: today.peak ? kW(today.peak.w) : DASH,
      label: "Peak today",
      sub: today.peak ? `At ${hhmm(today.peak.t)}` : "Not yet today",
    },
    {
      to: "readings",
      figure: best ? `${hourLabel(hourOf(best.start))}` : DASH,
      label: "Best hour",
      sub: best ? `${kWh(best.kwh)} in the hour` : "Not yet today",
    },
    {
      to: "performance",
      figure: vsUsual != null ? signedPct(vsUsual) : DASH,
      label: today.heading != null ? "Heading, against a usual day" : "Against a usual day",
      sub: usual ? `${kWh(usual)} is usual lately` : "Needs a few days of readings",
    },
    today.pace != null
      ? {
          to: "forecast",
          figure: signedPct(today.pace),
          label: "On this morning's forecast",
          sub: today.planned != null ? `${kWh(today.planned)} was forecast` : "",
        }
      : {
          to: "forecast",
          figure: today.tomorrow ? kWh(today.tomorrow.pv_kwh) : DASH,
          label: "Tomorrow, expected",
          sub: "From the weather forecast",
        },
  ];
  return (
    <section aria-labelledby="solar-highlights" className="flex flex-col gap-3.5">
      <h2 id="solar-highlights">Highlights</h2>
      <div className="grid grid-cols-4 gap-4 max-xl:grid-cols-2">
        {cards.map((c) => {
          const s = SECTIONS.find((x) => x.key === c.to)!;
          return (
            <Link
              key={c.label}
              to={s.to}
              className="glass group flex flex-col gap-1 rounded-3xl border border-line-subtle p-5 text-ink no-underline transition-colors hover:border-line max-sm:rounded-[20px] max-sm:p-4"
            >
              <span className="flex items-start justify-between gap-2">
                <span className="text-[30px] leading-9 font-light tracking-[-0.5px] text-solar tabular-nums max-sm:text-[24px] max-sm:leading-8">
                  {c.figure}
                </span>
                <Icon
                  name="chevR"
                  size={16}
                  className="mt-2 text-ink-faint transition-transform group-hover:translate-x-0.5"
                />
              </span>
              <span className="text-sm">{c.label}</span>
              <span className="text-[13px] text-ink-muted">{c.sub}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
