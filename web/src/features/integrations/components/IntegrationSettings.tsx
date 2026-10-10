import { useQuery } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { amberQuery } from "~/features/amber/api";
import { carsQuery } from "~/features/car/api";
import { carName } from "~/features/car/utils";
import { errorMessage } from "~/features/common/api/utils";
import { locationLabel } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useLocationSet } from "~/features/common/settings/hooks";
import { COLOR } from "~/features/common/theme/utils/colors";
import { buttonClass } from "~/features/common/ui/components/Button";
import { SummaryCard, SummaryStat } from "~/features/common/ui/components/Summary";
import { useForecast } from "~/features/common/weather/hooks";
import { teslaQuery } from "~/features/ev/api";
import { MODE_LABEL, PROVIDER_LABEL } from "~/features/ev/utils";
import { gridQuery } from "~/features/grid/api";
import { homeQuery } from "~/features/home/api";
import type { HomeIntegration } from "~/features/home/types";
import { integrationIcon, integrationReach } from "~/features/home/utils";
import { IntegrationLink } from "~/features/integrations/components/IntegrationLink";
import { ReachTag, UntestedTag, type Reach } from "~/features/integrations/components/ReachTag";
import { useInverters } from "~/features/integrations/hooks";
import type { InverterKind } from "~/features/integrations/types";
import type { InverterState } from "~/features/integrations/utils";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Sungrow SH5.0RS" as "SH5.0RS", when the brand is said beside it. */
const withoutBrand = (name: string, brand: string | null) =>
  brand && name.startsWith(`${brand} `) ? name.slice(brand.length + 1) : name;

type GroupId = "energy" | "home" | "vehicles" | "services";

/**
 * One integration on the hub: whether it's set up (and if so, working), how it's read, its card for "Connected", and
 * its tile for "Add an integration" while it isn't.
 */
type Entry = {
  id: string;
  group: GroupId;
  name: string;
  connected: boolean;
  /** Set up, but not working: signed out, not answering, not updating. */
  attention: boolean;
  /** Read on the home network, over Bluetooth or from public data: not through a company's cloud. */
  local: boolean;
  card: ReactElement;
  tile?: ReactElement;
};

const tags = (reach: Reach | Reach[], untested?: boolean) => (
  <>
    {(Array.isArray(reach) ? reach : [reach]).map((r) => (
      <ReachTag key={r} reach={r} />
    ))}
    {untested && <UntestedTag />}
  </>
);

/** The inverters at a glance: whether they're all answering, else what isn't. */
function inverterStatus(inverters: InverterState[]): { status: string; on: boolean; detail: string } {
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
  return { status: "Connected", on: true, detail: inverters.map((i) => i.name).join(" and ") };
}

/** Each brand the collector can read, with whether its drivers have been tried on a real one. */
function brandsOf(kinds: InverterKind[]): { brand: string; verified: boolean; labels: string[] }[] {
  const out = new Map<string, { brand: string; verified: boolean; labels: string[] }>();
  for (const k of kinds) {
    const b = out.get(k.brand) ?? { brand: k.brand, verified: true, labels: [] };
    b.verified &&= k.verified !== false;
    b.labels.push(k.label);
    out.set(k.brand, b);
  }
  return [...out.values()];
}

function useInverterEntries(): Entry[] {
  const { data, isPending, error, inverters } = useInverters();
  const summary = isPending
    ? { status: "Checking", on: false, detail: "Checking what's connected…" }
    : error || !data?.available
      ? { status: "Unavailable", on: false, detail: error ? errorMessage(error) : (data?.error ?? "") }
      : inverterStatus(inverters);
  const connected = inverters.length > 0;
  const brands = brandsOf(data?.kinds ?? []);
  const have = new Set(inverters.map((i) => i.device.brand));
  const entries: Entry[] = [
    {
      id: "inverters",
      group: "energy",
      name: "Inverters",
      // Always listed: nothing is recorded without one, so it's where to start.
      connected: true,
      attention: connected && !summary.on,
      local: true,
      card: (
        <IntegrationLink
          card
          to="/integrations/inverters"
          icon="sun"
          name="Inverters"
          status={summary.status}
          on={summary.on}
          detail={<span className="line-clamp-2">{summary.detail}</span>}
          tags={tags("local")}
        />
      ),
    },
  ];
  // Brands not connected yet, to add.
  for (const b of brands.filter((b) => !have.has(b.brand))) {
    entries.push({
      id: `inverter-${b.brand}`,
      group: "energy",
      name: b.brand,
      connected: false,
      attention: false,
      local: true,
      card: <></>,
      tile: (
        <IntegrationLink
          card
          to="/integrations/inverters/connect"
          search={{ brand: b.brand }}
          icon="sun"
          name={`${b.brand} inverter`}
          detail={<span className="line-clamp-2">{b.labels.join(", ")}</span>}
          tags={tags("local", !b.verified)}
        />
      ),
    });
  }
  return entries;
}

function useWeatherEntry(): Entry {
  const live = useLive();
  const forecast = useForecast();
  const located = useLocationSet();
  return {
    id: "weather",
    group: "services",
    name: "Weather",
    connected: true,
    attention: located === false || forecast === null,
    local: true,
    card: (
      <IntegrationLink
        card
        to="/integrations/weather"
        icon="cloudSun"
        name="Weather"
        status={
          located === false
            ? "Needs your location"
            : forecast
              ? "Connected"
              : forecast === undefined
                ? "Checking"
                : "Unavailable"
        }
        on={!!forecast}
        detail={
          located === false
            ? "Choose where your panels are for the solar forecast, from Open-Meteo"
            : `Forecast for ${locationLabel(live?.system)}, from Open-Meteo`
        }
        tags={tags("public")}
      />
    ),
  };
}

function useAmberEntry(): Entry {
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
  const on = !!status?.connected && !!status.site_id && !status.error;
  const link = (
    <IntegrationLink
      card
      to="/integrations/amber"
      icon="dollar"
      name="Amber Electric"
      status={status?.connected ? label : undefined}
      on={on}
      detail={detail}
      tags={tags("cloud")}
    />
  );
  return {
    id: "amber",
    group: "services",
    name: "Amber Electric",
    connected: !!status?.connected,
    attention: !!status?.connected && !on,
    local: false,
    card: link,
    tile: link,
  };
}

function useCarEntry(): Entry {
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
  const link = (
    <IntegrationLink
      card
      to="/integrations/car"
      icon="car"
      name={cars && cars.length > 1 ? "Electric vehicles" : "Electric vehicle"}
      status={cars?.length ? label : undefined}
      on={!!cars?.length}
      detail={detail}
    />
  );
  return {
    id: "car",
    group: "vehicles",
    name: "Electric vehicle",
    connected: !!cars?.length,
    attention: false,
    local: true,
    card: link,
    tile: link,
  };
}

function useGridEntry(): Entry {
  const { data: grid, isPending, error } = useQuery(gridQuery);
  const out = grid?.outages;
  const [label, detail] = isPending
    ? ["Checking", "Checking…"]
    : error || !grid
      ? ["Unavailable", errorMessage(error)]
      : !grid.location_set
        ? [
            grid.enabled ? "Prices only" : "Needs your location",
            [
              grid.enabled && `AEMO prices for ${grid.region_name}`,
              "Set your location for outages and warnings near you",
            ]
              .filter(Boolean)
              .join(" · "),
          ]
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
  return {
    id: "grid",
    group: "services",
    name: "Grid",
    connected: true,
    attention: !!out?.error,
    local: true,
    card: (
      <IntegrationLink
        card
        to="/integrations/grid"
        icon="grid"
        name="Grid"
        status={label}
        on={!!out?.network && !out.error}
        detail={<span className="line-clamp-2">{detail}</span>}
        tags={tags("public")}
      />
    ),
  };
}

function useTeslaEntry(): Entry {
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
  const reach: Reach[] = status?.connected
    ? [status.provider === "bluetooth" ? "bluetooth" : "cloud"]
    : ["bluetooth", "cloud"];
  const link = (
    <IntegrationLink
      card
      to="/integrations/tesla"
      icon={status?.provider === "bluetooth" ? "bluetooth" : "bolt"}
      name="Tesla"
      status={status?.connected ? label : undefined}
      on={!!status?.connected && !status.error}
      detail={detail}
      tags={tags(reach)}
    />
  );
  return {
    id: "tesla",
    group: "vehicles",
    name: "Tesla",
    connected: !!status?.connected,
    attention: !!status?.connected && !!status.error,
    local: status?.provider === "bluetooth",
    card: link,
    tile: link,
  };
}

/** A smart-home integration (Hisense through ConnectLife…): whether it's connected and reading, and its devices. */
function homeEntry(i: HomeIntegration): Entry {
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
  const link = (
    <IntegrationLink
      card
      to="/integrations/home/$integration"
      params={{ integration: i.id }}
      icon={integrationIcon(i)}
      name={i.name}
      status={a ? label : undefined}
      on={!!a && !a.error && !!a.last_poll}
      detail={<span className="line-clamp-2">{detail}</span>}
      tags={tags(integrationReach(i))}
    />
  );
  return {
    id: `home-${i.id}`,
    group: "home",
    name: i.name,
    connected: !!a,
    attention: !!a && (a.signed_out || !!a.error),
    local: integrationReach(i) !== "cloud",
    card: link,
    tile: link,
  };
}

const GROUPS: { id: GroupId; title: string; sub: string; add: string }[] = [
  {
    id: "energy",
    title: "Solar and battery",
    sub: "Your inverters, and the battery they run",
    add: "Inverters it reads on your network, by brand",
  },
  {
    id: "home",
    title: "Smart home",
    sub: "Appliances and plugs that measure what they use, for the breakdown on the Home page",
    add: "Plugs, meters and appliances, for the breakdown on the Home page",
  },
  {
    id: "vehicles",
    title: "Electric vehicles",
    sub: "Your cars, and charging them from spare solar",
    add: "Your car, and charging it from spare solar",
  },
  {
    id: "services",
    title: "Grid, prices and weather",
    sub: "Outages around you, where your prices come from, and the solar forecast",
    add: "Where your prices come from",
  },
];

/** A group of cards under a heading, two across where there's room. */
function Group({ id, title, sub, children }: { id: string; title: string; sub: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`h-${id}`} className="flex scroll-mt-28 flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id={`h-${id}`}>{title}</h2>
        <span className="text-sm text-ink-muted">{sub}</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,420px),1fr))] gap-4">{children}</div>
    </section>
  );
}

/** What's connected at a glance: how many, whether any need a look, the inverters, the smart home, and how much of
 * it is read on the home network rather than through a cloud. */
function Summary({ entries, devices }: { entries: Entry[]; devices: number }) {
  const { inverters } = useInverters();
  const connected = entries.filter((e) => e.connected);
  const attention = connected.filter((e) => e.attention);
  const local = connected.filter((e) => e.local).length;
  const main = inverters.find((i) => i.hybrid);
  const homes = entries.filter((e) => e.group === "home" && e.connected).length;
  return (
    <SummaryCard
      icon="plug"
      color={attention.length ? COLOR.warn : COLOR.brand}
      label="Your integrations"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-4 text-[13px] text-ink-muted">
          <span className="min-w-0 flex-1">
            {attention.length
              ? `${attention.map((e) => e.name).join(", ")} ${attention.length === 1 ? "needs" : "need"} a look.`
              : "Everything connected is answering."}{" "}
            <span className="text-ink-faint max-sm:hidden">
              WattsMyPower reads devices on your own network wherever it can, and a company&apos;s cloud only where
              there&apos;s no other way.
            </span>
          </span>
          <a href="#add" className={buttonClass("outline", "sm")}>
            Add an integration
          </a>
        </div>
      }
    >
      <SummaryStat label="Connected" value={connected.length} sub={`of ${plural(entries.length, "integration")}`} />
      <SummaryStat
        label="Need a look"
        value={attention.length}
        color={attention.length ? COLOR.warn : undefined}
        sub={attention.length ? attention[0].name : "All working"}
      />
      <SummaryStat
        label="Main inverter"
        value={main ? withoutBrand(main.name, main.device.brand) : "None yet"}
        sub={
          main
            ? [main.device.brand, inverters.length > 1 && "+1 more"].filter(Boolean).join(", ")
            : "Connect one to record"
        }
      />
      <SummaryStat label="Smart home" value={plural(devices, "device")} sub={`from ${plural(homes, "integration")}`} />
      <SummaryStat
        label="On your network"
        value={`${local} of ${connected.length}`}
        sub={connected.length - local ? `${connected.length - local} through a cloud` : "No clouds"}
      />
    </SummaryCard>
  );
}

/**
 * Manage → Integrations: a summary of what's connected, then each connected integration as a card with how it's
 * doing (opening to its own page), grouped by what it's for, then everything else that can be added.
 */
export function IntegrationSettings() {
  const { data: home, error: homeError } = useQuery(homeQuery);
  const entries = [
    ...useInverterEntries(),
    ...(home?.integrations ?? []).filter((i) => !i.demo || i.account).map(homeEntry),
    useCarEntry(),
    useTeslaEntry(),
    useGridEntry(),
    useAmberEntry(),
    useWeatherEntry(),
  ];
  const devices = (home?.integrations ?? []).reduce((n, i) => n + (i.account?.devices ?? 0), 0);
  const listed = entries.filter((e) => e.connected);
  const toAdd = entries.filter((e) => !e.connected && e.tile);
  return (
    <div className="flex flex-col gap-8">
      <Summary entries={entries.filter((e) => !e.id.startsWith("inverter-"))} devices={devices} />
      {GROUPS.map((g) => {
        const cards = listed.filter((e) => e.group === g.id);
        return (
          cards.length > 0 && (
            <Group key={g.id} id={g.id} title={g.title} sub={g.sub}>
              {cards.map((e) => (
                <div key={e.id} className="contents">
                  {e.card}
                </div>
              ))}
            </Group>
          )
        );
      })}
      {homeError && <p className="m-0 text-sm text-bad">{errorMessage(homeError)}</p>}
      {toAdd.length > 0 && (
        <section id="add" aria-labelledby="h-add" className="flex scroll-mt-28 flex-col gap-5">
          <div className="flex flex-col gap-0.5 border-t border-line-subtle pt-7">
            <h2 id="h-add">Add an integration</h2>
            <span className="text-sm text-ink-muted">
              Everything else WattsMyPower can read. Each says how it&apos;s reached: on your network, over Bluetooth,
              or through its maker&apos;s cloud.
            </span>
          </div>
          {GROUPS.map((g) => {
            const tiles = toAdd.filter((e) => e.group === g.id);
            return (
              tiles.length > 0 && (
                <div key={g.id} className="flex flex-col gap-3">
                  <div className="flex flex-col gap-0.5">
                    <h3 className="text-[15px] font-semibold">{g.title}</h3>
                    <span className="text-[13px] text-ink-muted">{g.add}</span>
                  </div>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-3">
                    {tiles.map((e) => (
                      <div key={e.id} className="contents">
                        {e.tile}
                      </div>
                    ))}
                  </div>
                </div>
              )
            );
          })}
        </section>
      )}
    </div>
  );
}
