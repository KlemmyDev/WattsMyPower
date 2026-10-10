import { useQuery } from "@tanstack/react-query";
import { useState, type FormEvent, type ReactNode } from "react";
import { locationLabel } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { useLive } from "~/features/common/live/hooks/useLive";
import { LocationPrompt } from "~/features/common/settings/components/LocationPrompt";
import { useLocationSet, useSaveSettings } from "~/features/common/settings/hooks";
import type { Settings } from "~/features/common/settings/types";
import { failure, saveSettingsError } from "~/features/common/settings/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input, Select } from "~/features/common/ui/components/Field";
import { Notice } from "~/features/common/ui/components/Notice";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { Switch } from "~/features/common/ui/components/Switch";
import { useToast } from "~/features/common/ui/components/Toast";
import { gridQuery } from "~/features/grid/api";
import { RADII } from "~/features/grid/components/OutagesCard";
import { REGIONS, listed } from "~/features/grid/utils";
import { SettingsCard } from "~/features/settings/components/SettingsCard";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";
import { useGeocode } from "~/features/settings/hooks/useGeocode";

/** The networks whose outages can be followed, by state. */
const NETWORKS = [
  {
    state: "Queensland",
    networks: [
      { id: "energex", name: "Energex", area: "South East Queensland" },
      { id: "ergon", name: "Ergon Energy", area: "regional Queensland" },
    ],
  },
  {
    state: "New South Wales and the ACT",
    networks: [
      { id: "ausgrid", name: "Ausgrid", area: "Sydney, the Central Coast and the Hunter" },
      { id: "endeavour", name: "Endeavour Energy", area: "Western Sydney, Illawarra and the South Coast" },
      { id: "essential", name: "Essential Energy", area: "regional NSW" },
      { id: "evoenergy", name: "Evoenergy", area: "the ACT" },
    ],
  },
  {
    state: "Victoria",
    networks: [
      { id: "citipower", name: "CitiPower", area: "inner Melbourne" },
      { id: "jemena", name: "Jemena", area: "Melbourne's north-west" },
      { id: "united", name: "United Energy", area: "Melbourne's south-east" },
      { id: "ausnet", name: "AusNet Services", area: "eastern Victoria" },
      { id: "powercor", name: "Powercor", area: "western Victoria" },
    ],
  },
  { state: "South Australia", networks: [{ id: "sapn", name: "SA Power Networks", area: "South Australia" }] },
  { state: "Tasmania", networks: [{ id: "tasnetworks", name: "TasNetworks", area: "Tasmania" }] },
  {
    state: "Western Australia",
    networks: [
      { id: "westernpower", name: "Western Power", area: "Perth and the South West" },
      { id: "horizon", name: "Horizon Power", area: "regional WA" },
    ],
  },
] as const;

function CardTitle({ id, title, sub, aside }: { id: string; title: string; sub: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 id={id} className="text-[15px] font-semibold">
          {title}
        </h3>
        <span className="text-sm text-pretty text-ink-muted">{sub}</span>
      </div>
      {aside}
    </div>
  );
}

/** Save a setting straight away, with a toast to say so. */
function useSaveNow() {
  const save = useSaveSettings();
  const toast = useToast();
  return {
    ...save,
    now: (changes: Partial<Settings>, said: string) =>
      save.mutate(changes, { onSuccess: () => toast(said), onError: (e) => toast(saveSettingsError(e)) }),
  };
}

const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

/** Which network's outages to follow: worked out from where the house is, one of them, or none. */
function Network() {
  const system = useLive()?.system;
  const { data: grid } = useQuery(gridQuery);
  const save = useSaveNow();
  const out = grid?.outages;
  const value = (save.isPending ? save.variables?.power_network : system?.power_network) ?? "auto";
  const found =
    out?.network_auto && out.network
      ? `Automatic (${out.network.name})`
      : out && !out.location_set
        ? "Automatic (needs your location)"
        : "Automatic";
  return (
    <SettingsCard padded aria-labelledby="h-network" className="gap-4">
      <CardTitle
        id="h-network"
        title="Electricity network"
        sub={
          <>
            The company that owns the poles and wires to your house (not your retailer). Its outage map says where the
            power's off now and where it's planned to be, every 15 minutes.
            {out?.fetched_at && ` Updated ${hhmm(out.fetched_at)}.`}
          </>
        }
        aside={
          <Select
            aria-label="Electricity network"
            value={value}
            onChange={(e) =>
              save.now(
                { power_network: e.target.value as Settings["power_network"] },
                e.target.value === "none" ? "Outages won't be followed." : "Saved. Fetching its outages.",
              )
            }
            className="h-9 text-sm"
          >
            <option value="auto">{found}</option>
            {NETWORKS.map((g) => (
              <optgroup key={g.state} label={g.state}>
                {g.networks.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name} ({n.area})
                  </option>
                ))}
              </optgroup>
            ))}
            <option value="none">Don't follow outages</option>
          </Select>
        }
      />
      {out?.error && (
        <HelpText>
          {out.error} It tries again every 15 minutes
          {out.fetched_at ? `, and shows the outages as they were at ${hhmm(out.fetched_at)} meanwhile.` : "."}
        </HelpText>
      )}
      {value === "auto" && !out?.network && out?.location_set && (
        <HelpText>
          No supported network found for {locationLabel(system)}. Every state's and territory's networks are, but the
          Northern Territory's.
        </HelpText>
      )}
      {value === "auto" && out && out.networks.length > 1 && (
        <HelpText>
          {locationLabel(system)} could be served by {listed(out.networks.map((n) => n.name))}, so outages from each are
          shown. Choose yours to see only its outages.
        </HelpText>
      )}
      <HelpText>
        From each network's public outage map (there's no official feed, so it may change). The network's outages are
        downloaded and matched here: your street is never sent anywhere. Essential Energy's map only gives an area's
        outages, so it's asked for the area within your radius.
      </HelpText>
    </SettingsCard>
  );
}

/**
 * The house's street (its name, never its number) and suburb, to tell which outages reach it: found by searching the
 * address, or typed in. Planned work lists the streets it turns off, so without a street only an outage's area can.
 */
function Street() {
  const system = useLive()?.system;
  const save = useSaveSettings();
  const toast = useToast();
  const geocode = useGeocode();
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [typing, setTyping] = useState(false);
  const [street, setStreet] = useState(system?.home_street ?? "");
  const [suburb, setSuburb] = useState(system?.home_suburb ?? "");
  const saved = system?.home_street;
  const keep = (home_street: string, home_suburb: string) =>
    save.mutate(
      { home_street, home_suburb },
      {
        onSuccess: () => {
          setError("");
          setTyping(false);
          geocode.reset();
          toast(home_street ? "Street saved." : "Street removed.");
        },
        onError: (e) => setError(saveSettingsError(e)),
      },
    );
  const search = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (q.trim().length < 3) return setError("Enter your address: number, street and suburb.");
    geocode.mutate(q.trim(), { onError: (err) => setError(failure(err, "The search didn't work. Try again.")) });
  };
  const places = geocode.data?.filter((p) => p.road);
  return (
    <SettingsCard padded aria-labelledby="h-street" className="gap-4">
      <CardTitle
        id="h-street"
        title="Your street"
        sub={
          saved ? (
            <>
              Outages listing <b className="font-semibold text-ink">{title(saved)}</b>
              {system?.home_suburb && (
                <>
                  {" "}
                  in <b className="font-semibold text-ink">{title(system.home_suburb)}</b>
                </>
              )}{" "}
              are marked as reaching you.
            </>
          ) : (
            "Planned work lists the streets it turns off. Add yours to know which reach you."
          )
        }
        aside={
          saved && (
            <Button variant="outline" size="sm" onClick={() => keep("", "")} disabled={save.isPending}>
              Remove
            </Button>
          )
        }
      />
      <form className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 max-[520px]:grid-cols-1" onSubmit={search}>
        <Field label="Your address">
          <Input
            placeholder="For example, 12 Smith St Paddington"
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </Field>
        <Button type="submit" size="sm" disabled={geocode.isPending}>
          Find
        </Button>
      </form>
      <div className="flex flex-col gap-1.5 empty:hidden">
        {geocode.isPending ? (
          <HelpText>Searching…</HelpText>
        ) : places && places.length ? (
          places.map((p, i) => (
            <button
              key={i}
              type="button"
              className="flex items-baseline justify-between gap-3 rounded-[10px] border border-line bg-surface px-3.5 py-3 text-left text-sm font-medium text-ink hover:border-line-strong hover:bg-surface-raised"
              onClick={() => keep(p.road ?? "", p.suburb ?? "")}
            >
              <span>
                {p.road}, {p.suburb}
              </span>
              <small className="text-xs font-normal text-ink-faint">{p.detail}</small>
            </button>
          ))
        ) : (
          places && <HelpText>No street found. Try the number, street and suburb, or type them in.</HelpText>
        )}
      </div>
      <HelpText tone="bad">{error}</HelpText>
      <HelpText>
        Searches OpenStreetMap. Only the street's name and the suburb are saved, never the number.
        <Button variant="link" className="ml-1 text-xs" onClick={() => setTyping((o) => !o)}>
          Type them in instead
        </Button>
      </HelpText>
      {typing && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))_auto] items-end gap-3">
          <Field label="Street">
            <Input autoFocus placeholder="Smith Street" value={street} onChange={(e) => setStreet(e.target.value)} />
          </Field>
          <Field label="Suburb">
            <Input placeholder="Paddington" value={suburb} onChange={(e) => setSuburb(e.target.value)} />
          </Field>
          <Button size="sm" onClick={() => keep(street.trim(), suburb.trim())} disabled={save.isPending}>
            Save
          </Button>
        </div>
      )}
    </SettingsCard>
  );
}

/** How far around the house outages are shown. */
function Radius() {
  const system = useLive()?.system;
  const save = useSaveNow();
  const value = (save.isPending ? save.variables?.outage_radius_km : system?.outage_radius_km) ?? 15;
  return (
    <SettingsCard padded aria-labelledby="h-radius" className="gap-4">
      <CardTitle
        id="h-radius"
        title="How far around"
        sub={`Outages within this distance of ${locationLabel(system)} are shown on the Grid page and the Overview. Ones that reach your street always are.`}
        aside={
          <Segmented
            label="Outage radius"
            options={RADII.map((r) => ({ value: String(r), label: `${r} km` }))}
            value={String(RADII.includes(value) ? value : 15)}
            onChange={(v) => save.now({ outage_radius_km: +v }, `Outages within ${v} km are shown.`)}
          />
        }
      />
    </SettingsCard>
  );
}

/** The Bureau of Meteorology's and the Fire Department's warnings for the house, on or off. */
function Hazards() {
  const system = useLive()?.system;
  const { data: grid } = useQuery(gridQuery);
  const save = useSaveNow();
  const on = save.isPending ? !!save.variables?.hazard_warnings : (system?.hazard_warnings ?? 1) === 1;
  const town = grid?.hazards?.town;
  return (
    <SettingsCard padded aria-labelledby="h-hazards" className="gap-4">
      <CardTitle
        id="h-hazards"
        title="Weather and fire warnings"
        sub={
          <>
            The Bureau of Meteorology's severe weather, flood and fire weather warnings
            {town ? ` for the ${town} area` : " for your area"}, and in Queensland the Fire Department's bushfire
            warnings within your radius. They feed the Grid page's outlook.
          </>
        }
        aside={
          <Switch
            on={on}
            label="Weather and fire warnings"
            onChange={(v) =>
              save.now(
                { hazard_warnings: v ? 1 : 0 },
                v ? "Following weather and fire warnings." : "Warnings turned off.",
              )
            }
          />
        }
      />
      <HelpText>
        From the Bureau's public data service and QFD's public warnings feed, both meant for this. Matched to your
        location here.
      </HelpText>
    </SettingsCard>
  );
}

/** The NEM region whose wholesale prices and notices (AEMO) the Grid page follows. */
function Market() {
  const system = useLive()?.system;
  const { data: grid } = useQuery(gridQuery);
  const save = useSaveNow();
  const value = (save.isPending ? save.variables?.nem_region : system?.nem_region) ?? "auto";
  const found =
    grid?.region_auto && grid.region_name
      ? `Automatic (${grid.region_name})`
      : grid && !grid.location_set
        ? "Automatic (needs your location)"
        : "Automatic";
  return (
    <SettingsCard padded aria-labelledby="h-market" className="gap-4">
      <CardTitle
        id="h-market"
        title="Wholesale market"
        sub={
          <>
            AEMO's wholesale prices for your region every five minutes, and its warnings of tight supply and load
            shedding. Public data, no account.{grid?.fetched_at && ` Updated ${hhmm(grid.fetched_at)}.`}
          </>
        }
        aside={
          <Select
            aria-label="Region"
            value={value}
            onChange={(e) =>
              save.now(
                { nem_region: e.target.value as Settings["nem_region"] },
                e.target.value === "none" ? "AEMO won't be followed." : "Saved. Fetching its prices.",
              )
            }
            className="h-9 text-sm"
          >
            <option value="auto">{found}</option>
            {REGIONS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
            <option value="none">Don't follow AEMO</option>
          </Select>
        }
      />
      {grid?.error && <Notice tone="warn">{grid.error}</Notice>}
    </SettingsCard>
  );
}

/** Manage → Integrations → Grid: the electricity network's outages, the street they're matched to, and AEMO. */
export function GridSettings() {
  const system = useLive()?.system;
  const located = useLocationSet();
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/integrations">Integrations</BackLink>}
        id="h-grid"
        title="Grid"
        sub="Power outages around your house from your electricity network, weather and fire warnings, and the wholesale market from AEMO, for the Grid page."
      />
      {located === false && (
        <LocationPrompt>
          Outages, warnings and your region are worked out from where your house is, so they need your location.
        </LocationPrompt>
      )}
      {/* Started afresh once the saved street is known, and after it's saved. */}
      <Network />
      <Street key={`${system?.home_street},${system?.home_suburb}`} />
      <Radius />
      <Hazards />
      <Market />
    </>
  );
}
