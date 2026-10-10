import { useQuery } from "@tanstack/react-query";
import type { ReactElement, ReactNode } from "react";
import { amberQuery } from "~/features/amber/api";
import { errorMessage } from "~/features/common/api/utils";
import { locationLabel } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useLocationSet } from "~/features/common/settings/hooks";
import { Pill } from "~/features/common/ui/components/Pill";
import { useForecast } from "~/features/common/weather/hooks";
import { bluelinkQuery, bydQuery, teslaQuery } from "~/features/ev/api";
import { bluelinkSummary, bydSummary, teslaSummary } from "~/features/ev/utils";
import { gridQuery } from "~/features/grid/api";
import { homeQuery } from "~/features/home/api";
import type { HomeIntegration, HomeOverview } from "~/features/home/types";
import { integrationIcon, integrationReach } from "~/features/home/utils";
import { IntegrationLink } from "~/features/integrations/components/IntegrationLink";
import { ReachTag, UntestedTag, type Reach } from "~/features/integrations/components/ReachTag";
import { useInverters } from "~/features/integrations/hooks";
import type { InverterKind } from "~/features/integrations/types";
import { brandSlug, type InverterState } from "~/features/integrations/utils";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

type GroupId = "energy" | "home" | "vehicles" | "services";

const GROUPS: { id: GroupId; title: string; sub: string }[] = [
  { id: "energy", title: "Solar and battery", sub: "Inverters it reads on your network, by brand" },
  { id: "home", title: "Smart home", sub: "Plugs, meters and appliances, for the breakdown on the Home page" },
  { id: "vehicles", title: "Electric vehicles", sub: "Your car's charge, and charging it from spare solar" },
  { id: "services", title: "Grid, prices and weather", sub: "Outages and prices around you, and the solar forecast" },
];

/**
 * One integration on the hub: whether it's connected (and if so, working), and how it's shown: as a card under
 * Connected, or as a tile to connect it under Available.
 */
type Entry = {
  id: string;
  group: GroupId;
  name: string;
  connected: boolean;
  /** Connected, but not working: signed out, not answering, not updating. */
  attention: boolean;
  /** One of the inverter brands offered until an inverter's connected: they count as one integration. */
  brand?: boolean;
  /** A smart-home brand that's connected: counted, but shown inside the one Smart home card. */
  rolled?: boolean;
  /** Its card under Connected (when connected), or its tile under Available (when not). */
  view: ReactElement;
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
    return { status: "No main inverter", on: false, detail: "Connect your main inverter to start recording" };
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

/** The inverters as one card once any is connected; until then, a tile for each brand it reads. */
function useInverterEntries(): Entry[] {
  const { data, isPending, error, inverters } = useInverters();
  if (inverters.length) {
    const summary = inverterStatus(inverters);
    const attention = !summary.on && summary.status !== "Connecting";
    return [
      {
        id: "inverters",
        group: "energy",
        name: "Inverters",
        connected: true,
        attention,
        view: (
          <IntegrationLink
            card
            to="/integrations/inverters"
            icon="sun"
            name="Inverters"
            status={summary.status}
            on={summary.on}
            attention={attention}
            detail={<span className="line-clamp-2">{summary.detail}</span>}
            tags={tags("local")}
          />
        ),
      },
    ];
  }
  if (isPending) return [];
  if (error || !data?.available)
    // No collector to ask (the demo, or it's down or out of date): say so where the inverters would be.
    return [
      {
        id: "inverters",
        group: "energy",
        name: "Inverters",
        connected: true,
        attention: true,
        view: (
          <IntegrationLink
            card
            to="/integrations/inverters"
            icon="sun"
            name="Inverters"
            status="Unavailable"
            attention
            detail={<span className="line-clamp-2">{error ? errorMessage(error) : data?.error}</span>}
            tags={tags("local")}
          />
        ),
      },
    ];
  return brandsOf(data.kinds).map((b) => ({
    id: `inverter-${b.brand}`,
    group: "energy",
    name: b.brand,
    connected: false,
    attention: false,
    brand: true,
    view: (
      <IntegrationLink
        connect
        to="/integrations/inverters/$brand"
        params={{ brand: brandSlug(b.brand) }}
        icon="sun"
        name={`${b.brand} inverter`}
        detail={<span className="line-clamp-2">{b.labels.join(", ")}</span>}
        tags={tags("local", !b.verified)}
      />
    ),
  }));
}

function useWeatherEntry(): Entry {
  const live = useLive();
  const forecast = useForecast();
  const located = useLocationSet();
  const connected = located !== false;
  return {
    id: "weather",
    group: "services",
    name: "Weather",
    connected,
    attention: connected && forecast === null,
    view: connected ? (
      <IntegrationLink
        card
        to="/integrations/weather"
        icon="cloudSun"
        name="Weather"
        status={forecast ? "Connected" : forecast === undefined ? "Checking" : "Unavailable"}
        on={!!forecast}
        attention={forecast === null}
        detail={`Forecast for ${locationLabel(live?.system)}, from Open-Meteo`}
        tags={tags("public")}
      />
    ) : (
      <IntegrationLink
        connect
        to="/integrations/weather"
        icon="cloudSun"
        name="Weather"
        detail="The solar forecast for where your panels are, from Open-Meteo. Needs your location."
        tags={tags("public")}
      />
    ),
  };
}

function useAmberEntry(): Entry {
  const { data: status, isPending, error } = useQuery(amberQuery);
  const site = status?.sites.find((s) => s.id === status.site_id);
  const length = status?.interval_length;
  const connected = !!status?.connected;
  const on = connected && !!status?.site_id && !status?.error;
  const [label, detail] = !status
    ? [isPending ? "Checking" : "Unavailable", isPending ? "Checking the connection…" : errorMessage(error)]
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
  return {
    id: "amber",
    group: "services",
    name: "Amber Electric",
    connected,
    attention: connected && !on,
    view: connected ? (
      <IntegrationLink
        card
        to="/integrations/amber"
        icon="dollar"
        name="Amber Electric"
        status={label}
        on={on}
        attention={!on}
        detail={detail}
        tags={tags("cloud")}
      />
    ) : (
      <IntegrationLink
        connect
        to="/integrations/amber"
        icon="dollar"
        name="Amber Electric"
        detail="Cost your power at Amber's prices, which change every 5 or 30 minutes"
        tags={tags("cloud")}
      />
    ),
  };
}

function useGridEntry(): Entry {
  const { data: grid, isPending, error } = useQuery(gridQuery);
  const out = grid?.outages;
  const networks = out?.networks?.length ? out.networks : out?.network ? [out.network] : [];
  const connected = !!grid && (grid.enabled || networks.length > 0);
  const status = out?.error ? "Not updating" : networks.length ? "Following" : "Prices only";
  const detail = !grid
    ? isPending
      ? "Checking…"
      : errorMessage(error)
    : [
        networks.length
          ? `${networks.map((n) => n.name).join(" and ")} outages within ${out?.radius_km} km${out?.street ? "" : " (no street set)"}`
          : grid.location_set
            ? "No network's outages"
            : "Set your location for outages near you",
        grid.enabled ? `AEMO prices for ${grid.region_name}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
  return {
    id: "grid",
    group: "services",
    name: "Grid",
    connected,
    attention: !!out?.error,
    view: connected ? (
      <IntegrationLink
        card
        to="/integrations/grid"
        icon="grid"
        name="Grid"
        status={status}
        on={networks.length > 0 && !out?.error}
        attention={!!out?.error}
        detail={<span className="line-clamp-2">{detail}</span>}
        tags={tags("public")}
      />
    ) : (
      <IntegrationLink
        connect
        to="/integrations/grid"
        icon="grid"
        name="Grid"
        detail="Outages around you from your electricity network, AEMO's wholesale prices, and weather and fire warnings"
        tags={tags("public")}
      />
    ),
  };
}

/** Electric vehicles as one integration, opening to its brands (Tesla, Hyundai and Kia, BYD): a card once a car's
 * connected (saying
 * which brand needs a look, if one does), else a tile to connect one. */
function useEvEntry(): Entry {
  const { data: status } = useQuery(teslaQuery);
  const { data: bydStatus } = useQuery(bydQuery);
  const { data: bluelinkStatus } = useQuery(bluelinkQuery);
  const tesla = teslaSummary(status);
  const byd = bydSummary(bydStatus);
  const hk = bluelinkSummary(bluelinkStatus);
  const brands = [
    { name: "Tesla", ...tesla, reach: tesla.reach as Reach[] },
    { name: bluelinkStatus?.brand === "kia" ? "Kia" : "Hyundai", reach: ["cloud"] as Reach[], ...hk },
    { name: "BYD", reach: ["cloud"] as Reach[], ...byd },
  ].filter((b) => b.connected);
  const off = brands.find((b) => !b.on);
  return {
    id: "ev",
    group: "vehicles",
    name: "Electric vehicles",
    connected: brands.length > 0,
    attention: !!off,
    view: brands.length ? (
      <IntegrationLink
        card
        to="/integrations/ev"
        icon="car"
        name="Electric vehicles"
        status={off ? `${off.name}: ${off.status.toLowerCase()}` : "Connected"}
        on={!off}
        attention={!!off}
        detail={<span className="line-clamp-2">{brands.map((b) => b.detail).join(", ")}</span>}
        tags={tags([...new Set(brands.flatMap((b) => b.reach))], byd.connected || hk.connected)}
      />
    ) : (
      <IntegrationLink
        connect
        to="/integrations/ev"
        icon="car"
        name="Electric vehicles"
        detail="Your Tesla (over Bluetooth or through Tessie), Hyundai or Kia charged from spare solar; or your BYD's charge, through BYD's cloud"
        tags={tags(tesla.reach)}
      />
    ),
  };
}

/** A smart-home integration (Hisense through ConnectLife…): whether it's connected and reading, and its devices. Its
 * tile says what sort of device it brings (`category`: "Portable batteries"). */
function homeEntry(i: HomeIntegration, category?: string): Entry {
  const a = i.account;
  const reach = integrationReach(i);
  const attention = !!a && (a.signed_out || !!a.error);
  const [label, detail] = !a
    ? ["", i.about]
    : a.signed_out
      ? ["Sign in again", a.error ?? "Its sign-in no longer works"]
      : [
          a.error ? "Not updating" : a.last_poll ? "Connected" : "Connecting",
          [a.label, plural(a.devices, "device"), a.last_poll && `read ${hhmm(a.last_poll)}`]
            .filter(Boolean)
            .join(" · "),
        ];
  return {
    id: `home-${i.id}`,
    group: "home",
    name: i.name,
    connected: !!a,
    attention,
    rolled: !!a,
    view: (
      <IntegrationLink
        card={!!a}
        connect={!a}
        to="/integrations/home/$integration"
        params={{ integration: i.id }}
        icon={integrationIcon(i)}
        name={i.name}
        status={a ? label : undefined}
        on={!!a && !a.error && !!a.last_poll && !a.signed_out}
        attention={attention}
        detail={<span className="line-clamp-2">{detail}</span>}
        tags={
          <>
            {!a && category && <span className="text-xs whitespace-nowrap text-ink-faint">{category}</span>}
            {tags(reach)}
          </>
        }
      />
    ),
  };
}

/** The smart-home brands in the order Smart home lists them: by sort of device, each with its category's name. */
function homeEntries(home: HomeOverview | undefined): Entry[] {
  const categories = home?.categories ?? [];
  const rank = (i: HomeIntegration) => categories.findIndex((c) => c.id === i.category);
  return [...(home?.integrations ?? [])]
    .sort((a, b) => rank(a) - rank(b))
    .map((i) => homeEntry(i, categories.find((c) => c.id === i.category)?.label));
}

/** Every connected smart-home brand as one card, opening to Smart home (its brands, each with its devices). */
function smartHomeEntry(integrations: HomeIntegration[]): Entry | null {
  const on = integrations.filter((i) => i.account);
  if (!on.length) return null;
  const trouble = on.find((i) => i.account?.signed_out || i.account?.error);
  const devices = on.reduce((n, i) => n + (i.account?.devices ?? 0), 0);
  const reaches = [...new Set(on.map(integrationReach))];
  return {
    id: "smart-home",
    group: "home",
    name: "Smart home",
    connected: true,
    attention: !!trouble,
    view: (
      <IntegrationLink
        card
        to="/integrations/home"
        icon="plug"
        name="Smart home"
        status={
          trouble ? `${trouble.name}: ${trouble.account?.signed_out ? "sign in again" : "not updating"}` : "Connected"
        }
        on={!trouble}
        attention={!!trouble}
        detail={
          <span className="line-clamp-2">{`${on.map((i) => i.name).join(", ")} · ${plural(devices, "device")}`}</span>
        }
        tags={tags(reaches)}
      />
    ),
  };
}

/** A top-level section of the hub: its heading with a count, a line under it, then what's in it. */
function Section({
  id,
  title,
  count,
  sub,
  children,
}: {
  id: string;
  title: string;
  count: number;
  sub: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`h-${id}`} className="flex scroll-mt-28 flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 id={`h-${id}`} className="flex items-center gap-2.5">
          {title}
          <Pill tone="neutral">{count}</Pill>
        </h2>
        <span className="text-sm text-ink-muted">{sub}</span>
      </div>
      {children}
    </section>
  );
}

/**
 * Manage → Integrations: what's connected (each card opening to its own page, any needing a look first), then
 * everything else that can be connected, grouped by what it's for, as tiles that say Connect.
 */
export function IntegrationSettings() {
  const { data: home, error: homeError } = useQuery(homeQuery);
  const entries = [
    ...useInverterEntries(),
    ...homeEntries(home),
    useEvEntry(),
    useGridEntry(),
    useAmberEntry(),
    useWeatherEntry(),
  ];
  const order = (e: Entry) => GROUPS.findIndex((g) => g.id === e.group);
  const smartHome = smartHomeEntry(home?.integrations ?? []);
  const connected = [...entries.filter((e) => e.connected && !e.rolled), ...(smartHome ? [smartHome] : [])].sort(
    (a, b) => Number(b.attention) - Number(a.attention) || order(a) - order(b),
  );
  const available = entries.filter((e) => !e.connected);
  // The inverter brands on offer count as one integration (an inverter), however many brands there are.
  const firstBrand = available.find((e) => e.brand);
  const counted = [...entries.filter((e) => !e.brand), ...(firstBrand ? [firstBrand] : [])];
  return (
    <div className="flex flex-col gap-10">
      <Section
        id="connected"
        title="Connected"
        count={connected.length}
        sub="Set up and reading. Open one to see how it's doing, or to change it."
      >
        {connected.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,420px),1fr))] gap-4">
            {connected.map((e) => (
              <div key={e.id} className="contents">
                {e.view}
              </div>
            ))}
          </div>
        ) : (
          <p className="m-0 text-sm text-ink-muted">Nothing yet. Start with your inverter, below.</p>
        )}
        {connected.length > 0 && firstBrand && (
          <p className="m-0 text-sm text-warn">
            Nothing is recorded until your main inverter is connected: it's first under Available to connect.
          </p>
        )}
      </Section>
      {homeError && <p className="m-0 text-sm text-bad">{errorMessage(homeError)}</p>}
      {available.length > 0 && (
        <Section
          id="available"
          title="Available to connect"
          count={counted.filter((e) => !e.connected).length}
          sub="Everything else WattsMyPower can read. Each says how it's reached: on your network, over Bluetooth, from public data, or through its maker's cloud."
        >
          <div className="flex flex-col gap-6">
            {GROUPS.map((g) => {
              const tiles = available.filter((e) => e.group === g.id);
              return (
                tiles.length > 0 && (
                  <div key={g.id} className="flex flex-col gap-3">
                    <div className="flex flex-col gap-0.5">
                      <h3 className="text-[15px] font-semibold">{g.title}</h3>
                      <span className="text-[13px] text-ink-muted">{g.sub}</span>
                    </div>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-3">
                      {tiles.map((e) => (
                        <div key={e.id} className="contents">
                          {e.view}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}
