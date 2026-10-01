import type { Forecast } from "~/features/common/weather/types";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card, Footnote } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { Swatch } from "~/features/common/ui/components/Swatch";
import { useForecast } from "~/features/common/weather/hooks";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { useNow } from "~/features/common/time/hooks";
import { forecastSummary } from "~/features/forecast/utils";
import { locationLabel } from "~/features/common/energy/utils";
import { HourStrip } from "~/features/forecast/components/HourStrip";

export function ForecastPage() {
  const forecast = useForecast();
  return (
    <>
      <PageHeader
        title="Forecast"
        sub="Solar and battery forecast for the next 24 hours, based on the local weather outlook"
      />
      <LocationChip />
      {forecast && <SummaryCards forecast={forecast} />}
      <Card aria-labelledby="h-hbh">
        <div className="flex flex-col gap-0.5">
          <h2 id="h-hbh">Hour by hour</h2>
          <div className="text-sm text-ink-muted">
            Forecast solar per hour and predicted battery level at the end of each hour
          </div>
        </div>
        {forecast === null ? (
          <div className="py-6 text-sm text-ink-faint">
            Forecast unavailable. The server could not reach the Open-Meteo weather service, or the forecast is turned
            off.
          </div>
        ) : (
          forecast && <HourStrip forecast={forecast} />
        )}
        <div className="flex flex-wrap gap-5 text-xs text-ink-faint">
          <span className="flex items-center gap-1.5">
            <Swatch color="var(--color-solar)" size={10} />
            Forecast solar (kWh)
          </span>
          <span className="flex items-center gap-1.5">
            <Swatch color="var(--color-brand)" size={10} />
            Predicted battery level
          </span>
        </div>
      </Card>
      {forecast && (
        <Footnote>
          {forecast.calibration.fitted_hours >= 0.5
            ? `Solar forecast calibrated on ${forecast.calibration.fitted_hours} hours of your inverter's output.`
            : "Solar forecast not yet calibrated to your system. It needs a few daylight hours of data."}
        </Footnote>
      )}
    </>
  );
}

function LocationChip() {
  const system = useSystem();
  return (
    <div className="flex flex-wrap items-center gap-2 self-start rounded-full border border-chip-line bg-chip py-2 pr-3.5 pl-2.5 text-sm text-ink-muted">
      <span className="flex text-link">
        <Icon name="pin" size={16} />
      </span>
      <span>
        Outlook for <b className="font-semibold text-ink">{locationLabel(system)}</b>
      </span>
      <ButtonLink to="/settings/integrations" variant="link" size="sm" className="ml-1">
        Change
      </ButtonLink>
    </div>
  );
}

function SummaryCards({ forecast }: { forecast: Forecast }) {
  const snapshot = useSnapshot();
  const now = useNow();
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
      {forecastSummary(forecast, snapshot, now).map(([label, value]) => (
        <div key={label} className="flex flex-col gap-1 rounded-2xl border border-line-subtle bg-surface px-6 py-5">
          <div className="text-[13px] text-ink-muted">{label}</div>
          <div className="text-[32px] leading-10 font-light tracking-[-0.5px] tabular-nums">{value}</div>
        </div>
      ))}
    </div>
  );
}
