import type { AmberPrices } from "~/features/amber/types";
import type { Forecast } from "~/features/common/weather/types";
import type { SystemInfo } from "~/features/common/live/types";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card, CardHeader } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { hhmm } from "~/features/common/formatting/utils/date";
import { useFahrenheit } from "~/features/common/weather/hooks";
import { degrees, hourIcon, hourIconColor } from "~/features/common/weather/utils";
import { MomentList } from "~/features/plan/components/Moments";
import { next24 } from "~/features/overview/utils/next24";

type N24 = NonNullable<ReturnType<typeof next24>>;

/**
 * Next 24 hours, in brief: how much solar and the battery cover, the weather, the key moments and the totals.
 * The charts and the hour by hour are on the Plan page, which "Tomorrow's plan" opens at tomorrow.
 */
export function Next24Card({
  s,
  f,
  now,
  prices,
}: {
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  now: number;
  prices?: AmberPrices;
}) {
  const n = f ? next24(f, s, now, prices) : null;
  const today = new Date(now * 1000).toDateString();
  return (
    <Card aria-labelledby="h-next">
      <CardHeader
        title="Next 24 hours"
        id="h-next"
        action={
          <ButtonLink to="/plan" search={{ day: 1 }} variant="link">
            Tomorrow's plan
          </ButtonLink>
        }
      />
      {!n ? (
        <div className="text-[15px] leading-[23px] text-pretty text-ink-body">
          {f === undefined
            ? "Loading forecast"
            : "Forecast unavailable. The server could not reach the Open-Meteo weather service, or the forecast is turned off."}
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-8 max-lg:grid-cols-1 max-lg:gap-6">
          <div className="flex min-w-0 flex-col gap-6">
            <Coverage n={n} />
            <Weather n={n} />
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line-subtle">
              {n.stats.map(([label, value, color]) => (
                <div key={label} className="flex min-w-0 flex-col gap-1 bg-surface-inset px-4 py-3.5">
                  <span className="overflow-hidden text-xs text-ellipsis whitespace-nowrap text-ink-dim">{label}</span>
                  <span className="text-xl font-medium tabular-nums" style={{ color }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <h3 className="text-[15px] font-semibold">Key moments</h3>
            {n.moments.length ? (
              <MomentList
                moments={n.moments}
                day={(t) => (new Date(t * 1000).toDateString() === today ? "Today" : "Tomorrow")}
              />
            ) : (
              <p className="m-0 text-sm text-ink-dim">
                Nothing out of the ordinary: no rain, and no change worth noting.
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/** Headline and a bar of how much of the day's use solar and the battery cover. */
function Coverage({ n }: { n: N24 }) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-lg leading-[26px] font-medium text-pretty text-ink">{n.headline}</div>
      <div className="flex flex-col gap-1.5">
        <div className="flex h-2 overflow-hidden rounded-full bg-bar-faint">
          <div className="origin-left animate-fill-x bg-battery" style={{ width: `${n.cover.toFixed(1)}%` }} />
        </div>
        <div className="flex justify-between gap-3 text-xs text-ink-dim tabular-nums">
          <span className="whitespace-nowrap">Solar and battery · {Math.round(n.cover)}%</span>
          <span className="whitespace-nowrap">Grid · {n.gridKwh}</span>
        </div>
      </div>
    </div>
  );
}

/** The weather every three hours: icon, temperature and time. */
function Weather({ n }: { n: N24 }) {
  const fahrenheit = useFahrenheit();
  return (
    <div className="grid grid-cols-8 rounded-2xl bg-surface-inset py-3">
      {n.weather.map(({ at, h }) => {
        const icon = hourIcon(h);
        return (
          <div key={at} className="flex min-w-0 flex-col items-center gap-1">
            <span className="font-mono text-[10px] text-ink-label">{hhmm(Math.floor(at / 3600) * 3600)}</span>
            <span style={{ color: hourIconColor(icon) }}>
              <Icon name={icon} size={18} />
            </span>
            <span className="text-xs text-ink-soft tabular-nums">
              {h.temp != null ? degrees(h.temp, fahrenheit) : "–"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
