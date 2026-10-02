import { useState, type ReactNode } from "react";
import type { LiveStatus, Snapshot } from "~/features/common/live/types";
import { Button } from "~/features/common/ui/components/Button";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { Pill } from "~/features/common/ui/components/Pill";
import { isFresh, locationLabel } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { kW, kWh } from "~/features/common/formatting/utils/number";
import { useForecast } from "~/features/common/weather/hooks";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { inverterName } from "~/features/common/live/utils";
import { useNow } from "~/features/common/time/hooks";
import { LocationForm } from "~/features/settings/components/LocationForm";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";

function IntegrationRow({
  icon,
  name,
  on,
  status,
  detail,
  action,
  children,
}: {
  icon: IconName;
  name: ReactNode;
  on: boolean;
  status: string;
  detail: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-line-subtle px-6 py-5 last:border-b-0">
      <div className="flex size-11 flex-none items-center justify-center rounded-full bg-canvas text-ink">
        <Icon name={icon} size={22} />
      </div>
      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2 text-[15px] font-semibold">
          {name}
          <Pill tone={on ? "ok" : "neutral"} size="sm">
            {status}
          </Pill>
        </div>
        <span className="text-[13px] text-ink-muted">{detail}</span>
      </div>
      {action}
      {children}
    </div>
  );
}

function SecondInverterRow({ live, snapshot, now }: { live: LiveStatus; snapshot: Snapshot | null; now: number }) {
  const pv2 = live.system.pv2;
  if (!pv2) return null;
  const ok = !!pv2.last_success && now - pv2.last_success < (live.poll_interval || 60) * 3;
  const reading =
    ok && snapshot
      ? `${kW(snapshot.pv2_power)} now, ${kWh(snapshot.daily_pv2)} today`
      : pv2.last_success
        ? `last sync ${hhmm(pv2.last_success)} (it powers down after dark)`
        : "no data yet";
  return (
    <IntegrationRow
      icon="sun"
      name={inverterName(pv2) || "Second inverter"}
      on={ok}
      status={ok ? "Connected" : pv2.last_success ? "Not responding" : "Connecting"}
      detail={`Second solar system through its Wi-Fi dongle at ${pv2.host} · ${reading}`}
    />
  );
}

/** Settings → Integrations: the inverters and the weather forecast (with the location form), then what's coming. */
export function IntegrationSettings() {
  const live = useLive();
  const snapshot = useSnapshot();
  const forecast = useForecast();
  const now = useNow();
  const [locationOpen, setLocationOpen] = useState(false);
  const ok = isFresh(live, now);
  const last = live?.last_success;
  const forecastOk = !!forecast;

  return (
    <>
      <SettingsCard aria-label="Connected services">
        <IntegrationRow
          icon="sun"
          name={live?.system.brand ? `${live.system.brand} inverter` : "Inverter"}
          on={ok}
          status={ok ? "Connected" : "Not responding"}
          detail={`Inverter and battery data every minute over the local network · ${last ? `last sync ${hhmm(last)}` : "no data yet"}`}
        />
        {live && <SecondInverterRow live={live} snapshot={snapshot} now={now} />}
        <IntegrationRow
          icon="cloudSun"
          name="Weather forecast"
          on={forecastOk}
          status={forecastOk ? "Connected" : forecast === undefined ? "Checking" : "Unavailable"}
          detail={`Hourly cloud cover and temperature from Open-Meteo for ${locationLabel(live?.system)}`}
          action={
            <Button variant="outline" onClick={() => setLocationOpen((o) => !o)}>
              Change location
            </Button>
          }
        >
          {locationOpen && <LocationForm system={live?.system} onClose={() => setLocationOpen(false)} />}
        </IntegrationRow>
      </SettingsCard>

      <section aria-labelledby="h-soon" className="flex max-w-[880px] flex-col gap-3 pt-3">
        <SettingsTitle id="h-soon" title="Coming soon" sub="Integrations being worked on." />
        <SettingsCard>
          <IntegrationRow
            icon="car"
            name="Tesla"
            on={false}
            status="Coming soon"
            detail="Charge your car with excess solar while keeping enough for the home battery"
          />
        </SettingsCard>
      </section>
    </>
  );
}
