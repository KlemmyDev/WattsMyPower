import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { amberQuery } from "~/features/amber/api";
import { carsQuery } from "~/features/car/api";
import { carName } from "~/features/car/utils";
import { errorMessage } from "~/features/common/api/utils";
import { locationLabel } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useForecast } from "~/features/common/weather/hooks";
import { homeQuery } from "~/features/home/api";
import type { HomeIntegration } from "~/features/home/types";
import { integrationIcon } from "~/features/home/utils";
import { IntegrationLink } from "~/features/integrations/components/IntegrationLink";
import { useInverters } from "~/features/integrations/hooks";
import { gridQuery } from "~/features/grid/api";
import type { InverterState } from "~/features/integrations/utils";
import { teslaQuery } from "~/features/ev/api";
import { MODE_LABEL, PROVIDER_LABEL } from "~/features/ev/utils";

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
      to="/integrations/sungrow"
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
      to="/integrations/weather"
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
      to="/integrations/amber"
      icon="dollar"
      name="Amber Electric"
      status={label}
      on={!!status?.connected && !!status.site_id && !status.error}
      detail={detail}
    />
  );
}

function CarLink() {
  const { data: cars, isPending, error } = useQuery(carsQuery);
  const [label, detail] = isPending
    ? ["Checking", "Checking for cars…"]
    : error || !cars
      ? ["Unavailable", errorMessage(error)]
      : !cars.length
        ? ["Not connected", "Tell it about your EV: how it charges, and how the Overview draws it"]
        : [
            "Connected",
            cars.length === 1
              ? [carName(cars[0]), cars[0].level ? `${Math.round(cars[0].level.soc)}%` : null]
                  .filter(Boolean)
                  .join(" · ")
              : cars.map(carName).join(" and "),
          ];
  return (
    <IntegrationLink
      card
      to="/integrations/car"
      icon="car"
      name={cars && cars.length > 1 ? "Electric vehicles" : "Electric vehicle"}
      status={label}
      on={!!cars?.length}
      detail={detail}
    />
  );
}

function GridLink() {
  const { data: grid, isPending, error } = useQuery(gridQuery);
  const out = grid?.outages;
  const [label, detail] = isPending
    ? ["Checking", "Checking…"]
    : error || !grid
      ? ["Unavailable", errorMessage(error)]
      : [
          out?.network ? (out.error ? "Not updating" : "Following") : grid.enabled ? "Prices only" : "Not following",
          [
            out?.network
              ? `${out.network.name} outages within ${out.radius_km} km${out.street ? "" : " (no street set)"}`
              : "No network's outages",
            grid.enabled ? `AEMO prices for ${grid.region_name}` : null,
          ]
            .filter(Boolean)
            .join(" · "),
        ];
  return (
    <IntegrationLink
      card
      to="/integrations/grid"
      icon="grid"
      name="Grid"
      status={label}
      on={!!out?.network && !out.error}
      detail={<span className="line-clamp-2">{detail}</span>}
    />
  );
}

function TeslaLink() {
  const { data: status, isPending, error } = useQuery(teslaQuery);
  const [label, detail] = isPending
    ? ["Checking", "Checking the connection…"]
    : error || !status
      ? ["Unavailable", errorMessage(error)]
      : !status.connected
        ? ["Not connected", "Over Bluetooth or through Tessie, and charge it from spare solar"]
        : [
            status.error ? "Not updating" : `${status.provider ? PROVIDER_LABEL[status.provider] : "Connected"}`,
            status.vehicles
              .map((v) =>
                [v.name ?? "Tesla", v.state?.soc != null && `${Math.round(v.state.soc)}%`, MODE_LABEL[v.control.mode]]
                  .filter(Boolean)
                  .join(" · "),
              )
              .join(", "),
          ];
  return (
    <IntegrationLink
      card
      to="/integrations/tesla"
      icon={status?.provider === "bluetooth" ? "bluetooth" : "bolt"}
      name="Tesla"
      status={label}
      on={!!status?.connected && !status.error}
      detail={detail}
    />
  );
}

/** A smart-home integration (Hisense through ConnectLife…): whether it's connected and reading, and its devices. */
function HomeLink({ integration: i }: { integration: HomeIntegration }) {
  const a = i.account;
  const [label, detail] = !a
    ? ["Not connected", i.about]
    : a.signed_out
      ? ["Sign in again", a.error ?? "Its sign-in no longer works"]
      : [
          a.error ? "Not updating" : a.last_poll ? "Connected" : "Connecting",
          [
            a.label,
            `${a.devices} ${a.devices === 1 ? "device" : "devices"}`,
            a.last_poll && `read ${hhmm(a.last_poll)}`,
          ]
            .filter(Boolean)
            .join(" · "),
        ];
  return (
    <IntegrationLink
      card
      to="/integrations/home/$integration"
      params={{ integration: i.id }}
      icon={integrationIcon(i)}
      name={i.name}
      status={label}
      on={!!a && !a.error && !!a.last_poll}
      detail={<span className="line-clamp-2">{detail}</span>}
    />
  );
}

function SmartHomeLinks() {
  const { data, isPending, error } = useQuery(homeQuery);
  if (isPending) return null;
  if (error || !data) return <p className="m-0 text-sm text-bad">{errorMessage(error)}</p>;
  return data.integrations.map((i) => <HomeLink key={i.id} integration={i} />);
}

/** A group of integration cards under a heading, two across where there's room. */
function Group({ id, title, sub, children }: { id: string; title: string; sub: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`h-${id}`} className="flex scroll-mt-28 flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id={`h-${id}`}>{title}</h2>
        <span className="text-sm text-ink-muted">{sub}</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,480px),1fr))] gap-4">{children}</div>
    </section>
  );
}

/**
 * Manage → Integrations: each integration as a card with how it's doing, opening to its own page, grouped by what
 * it's for. Your solar and battery first, then smart appliances, the car, and the services rates and the forecast
 * come from.
 */
export function IntegrationSettings() {
  return (
    <div className="flex flex-col gap-8">
      <Group id="solar-battery" title="Solar and battery" sub="Your inverters, and the battery they run">
        <SungrowLink />
      </Group>
      <Group
        id="smart-home"
        title="Smart home"
        sub="Appliances and plugs that measure what they use, for the breakdown on the Home page"
      >
        <SmartHomeLinks />
      </Group>
      <Group id="vehicles" title="Electric vehicles" sub="Your cars, and charging them from spare solar">
        <CarLink />
        <TeslaLink />
      </Group>
      <Group
        id="prices-weather"
        title="Grid, prices and weather"
        sub="Outages around you, where your prices come from, and the solar forecast"
      >
        <GridLink />
        <AmberLink />
        <WeatherLink />
      </Group>
    </div>
  );
}
