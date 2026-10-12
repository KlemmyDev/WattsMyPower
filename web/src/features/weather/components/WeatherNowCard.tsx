import { hhmm } from "~/features/common/formatting/utils/date";
import type { Snapshot, SystemInfo } from "~/features/common/live/types";
import { Icon } from "~/features/common/ui/components/Icon";
import type { Forecast } from "~/features/common/weather/types";
import { codeIcon, liveWeather, liveWeatherIcon } from "~/features/common/weather/utils";
import { Quiet, WidgetCard } from "~/features/common/widgets/parts";

/** The sky now (as the power flow's chip has it), and, given room (`hours`), the next hours' temperatures. */
export function WeatherNowCard({
  p,
  s,
  f,
  now,
  hours = 5,
}: {
  p: Snapshot | null;
  s: SystemInfo | undefined;
  f: Forecast | null | undefined;
  now: number;
  hours?: number;
}) {
  if (!p)
    return (
      <WidgetCard title="Weather" icon="cloudSun">
        <Quiet>Loading…</Quiet>
      </WidgetCard>
    );
  const wx = liveWeather(p, f, now, !!s?.temp_unit_f);
  const next = (f?.hours ?? []).filter((h) => h.ts > now).slice(0, hours);
  return (
    <WidgetCard title="Weather" icon="cloudSun">
      <div className="flex items-center gap-3">
        <Icon name={liveWeatherIcon(wx)} size={34} className="text-solar" />
        <span className="flex flex-col">
          <span className="text-[28px] leading-8 font-light tabular-nums">{wx.temp ?? "—"}</span>
          <span className="text-xs text-ink-muted">{wx.name}</span>
        </span>
      </div>
      {next.length > 0 && (
        <div className="mt-auto flex justify-between gap-2">
          {next.map((h) => (
            <span key={h.ts} className="flex flex-col items-center gap-1 text-[11px] text-ink-muted">
              <span className="font-mono">{hhmm(h.ts).slice(0, 2)}</span>
              <Icon name={codeIcon(h.code, !!h.is_day)} size={15} />
              <span className="text-ink tabular-nums">{h.temp != null ? `${Math.round(h.temp)}°` : "—"}</span>
            </span>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}
