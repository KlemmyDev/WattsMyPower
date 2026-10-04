import { useQuery } from "@tanstack/react-query";
import { amberQuery } from "~/features/amber/api";
import { carQuery } from "~/features/car/api";
import { carName } from "~/features/car/utils";
import { errorMessage } from "~/features/common/api/utils";
import { locationLabel } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useForecast } from "~/features/common/weather/hooks";
import { IntegrationLink } from "~/features/integrations/components/IntegrationLink";
import { useInverters } from "~/features/integrations/hooks";
import type { InverterState } from "~/features/integrations/utils";

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
      card
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
      card
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
      card
      to="/settings/integrations/amber"
      icon="dollar"
      name="Amber Electric"
      status={label}
      on={!!status?.connected && !!status.site_id && !status.error}
      detail={detail}
    />
  );
}

function CarLink() {
  const { data: view, isPending, error } = useQuery(carQuery);
  const [label, detail] = isPending
    ? ["Checking", "Checking for a car…"]
    : error || !view
      ? ["Unavailable", errorMessage(error)]
      : !view.connected
        ? ["Not connected", "Tell it about your EV, and Plan suggests when to charge it from spare solar"]
        : [
            "Connected",
            [carName(view), view.level ? `${Math.round(view.level.soc)}%` : null, "charge times suggested on Plan"]
              .filter(Boolean)
              .join(" · "),
          ];
  return (
    <IntegrationLink
      card
      to="/settings/integrations/car"
      icon="car"
      name="Electric vehicle"
      status={label}
      on={!!view?.connected}
      detail={detail}
    />
  );
}

/**
 * Settings → Integrations: each integration as a card with how it's doing, opening to its own page. Your
 * inverters first, then the services and the car; two across where there's room.
 */
export function IntegrationSettings() {
  return (
    <section aria-label="Integrations" className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,480px),1fr))] gap-4">
      <SungrowLink />
      <WeatherLink />
      <AmberLink />
      <CarLink />
    </section>
  );
}
