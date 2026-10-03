import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { amberQuery } from "~/features/amber/api";
import { errorMessage } from "~/features/common/api/utils";
import { locationLabel } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useForecast } from "~/features/common/weather/hooks";
import { IntegrationLink, IntegrationTile } from "~/features/integrations/components/IntegrationLink";
import { useInverters } from "~/features/integrations/hooks";
import type { InverterState } from "~/features/integrations/utils";
import { SettingsCard } from "~/features/settings/components/SettingsCard";

/** A heading over a group of integrations. */
function Group({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex max-w-[880px] flex-col gap-2.5">
      <h2 id={id} className="px-1 font-sans text-[13px] leading-5 font-semibold tracking-normal text-ink-muted">
        {title}
      </h2>
      <SettingsCard>{children}</SettingsCard>
    </section>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The inverters at a glance: whether they're all answering, else what isn't. */
function sungrowStatus(inverters: InverterState[]): { status: string; on: boolean; detail: string } {
  if (!inverters.some((i) => i.hybrid))
    return {
      status: "Not connected",
      on: false,
      detail: inverters.length
        ? "Connect your main inverter to start recording"
        : "Connect your inverter to start recording",
    };
  const frozen = inverters.find((i) => i.frozen);
  const silent = inverters.filter((i) => !i.ok && i.last);
  const waiting = inverters.filter((i) => !i.last);
  if (frozen) return { status: "Frozen", on: false, detail: "Readings frozen – the dongle isn't refreshing them" };
  if (silent.length)
    return {
      status: "Not responding",
      on: false,
      detail:
        silent.length === 1 && !silent[0].hybrid
          ? "The second inverter isn't responding (it powers down after dark)"
          : `${plural(silent.length, "inverter")} not responding`,
    };
  if (waiting.length) return { status: "Connecting", on: false, detail: "Waiting for the first reading" };
  return { status: "Connected", on: true, detail: `${plural(inverters.length, "inverter")} connected` };
}

function SungrowLink() {
  const { data, isPending, error, inverters } = useInverters();
  const summary = isPending
    ? { status: "Checking", on: false, detail: "Checking what's connected…" }
    : error || !data?.available
      ? { status: "Unavailable", on: false, detail: error ? errorMessage(error) : (data?.error ?? "") }
      : sungrowStatus(inverters);
  return (
    <IntegrationLink
      to="/settings/integrations/sungrow"
      icon="sun"
      name="Sungrow"
      status={summary.status}
      on={summary.on}
      detail={<span className="line-clamp-2">{summary.detail}</span>}
    />
  );
}

function WeatherLink() {
  const live = useLive();
  const forecast = useForecast();
  return (
    <IntegrationLink
      to="/settings/integrations/weather"
      icon="cloudSun"
      name="Weather"
      status={forecast ? "Connected" : forecast === undefined ? "Checking" : "Unavailable"}
      on={!!forecast}
      detail={`Forecast for ${locationLabel(live?.system)}, from Open-Meteo`}
    />
  );
}

function AmberLink() {
  const { data: status, isPending, error } = useQuery(amberQuery);
  const site = status?.sites.find((s) => s.id === status.site_id);
  const length = status?.interval_length;
  const [label, detail] = isPending
    ? ["Checking", "Checking the connection…"]
    : error || !status
      ? ["Unavailable", errorMessage(error)]
      : !status.connected
        ? ["Not connected", "Cost your power at Amber's prices, which change every 5 or 30 minutes"]
        : !status.site_id
          ? ["Choose a site", "Your account has more than one site. Choose yours."]
          : [
              status.error ? "Not updating" : "Connected",
              [
                site?.network,
                length ? `${length}-minute prices` : "Prices",
                status.last_sync && `updated ${hhmm(status.last_sync)}`,
              ]
                .filter(Boolean)
                .join(" · "),
            ];
  return (
    <IntegrationLink
      to="/settings/integrations/amber"
      icon="dollar"
      name="Amber Electric"
      status={label}
      on={!!status?.connected && !!status.site_id && !status.error}
      detail={detail}
    />
  );
}

/** Settings → Integrations: each integration with how it's doing, opening to its own page. */
export function IntegrationSettings() {
  return (
    <div className="flex flex-col gap-6">
      <Group id="h-system" title="Your system">
        <SungrowLink />
      </Group>
      <Group id="h-services" title="Services">
        <WeatherLink />
        <AmberLink />
      </Group>
      <Group id="h-soon" title="Coming soon">
        <IntegrationTile
          icon="car"
          name="Tesla"
          status="Coming soon"
          detail="Charge your car with excess solar while keeping enough for the home battery"
        />
      </Group>
    </div>
  );
}
