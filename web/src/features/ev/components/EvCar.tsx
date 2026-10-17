import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm, minutesLabel, shortDay } from "~/features/common/formatting/utils/date";
import { sameDay } from "~/features/common/time/utils";
import { kW, pct } from "~/features/common/formatting/utils/number";
import { useNow } from "~/features/common/time/hooks";
import { Button } from "~/features/common/ui/components/Button";
import { Collapse } from "~/features/common/ui/components/Collapse";
import { DataRow } from "~/features/common/ui/components/DataRow";
import { HelpText } from "~/features/common/ui/components/Field";
import { Notice } from "~/features/common/ui/components/Notice";
import { CardText, Facts, SmallCard } from "~/features/common/ui/components/SmallCard";
import { cn } from "~/features/common/ui/utils";
import { detailsQuery } from "~/features/ev/api";
import { CarSteps } from "~/features/ev/components/CarSteps";
import { freshness, readiness } from "~/features/ev/components/EvHero";
import type { Reached } from "~/features/ev/components/ProviderChip";
import { useEvChange, useRefreshDetails } from "~/features/ev/hooks";
import type { DetailGroup, EvDetailGroups, EvDetails as Details, EvVehicle, SoftwareUpdate } from "~/features/ev/types";
import { carMood, carTitle } from "~/features/ev/utils";

const yes = (v: boolean | null | undefined, on = "Yes", off = "No") => (v == null ? "—" : v ? on : off);
const temp = (c: number | null | undefined) => (c == null ? "—" : `${c.toFixed(1)} °C`);
const PSI_PER_BAR = 14.5038;
/** A tyre's pressure (the car gives bar) in PSI, whole, as on the car's screen. */
const psi = (b: number | null | undefined) => (b == null ? "—" : `${Math.round(b * PSI_PER_BAR)} PSI`);
const list = (items: string[] | undefined, none: string) => (items?.length ? items.join(", ") : none);
const TYRES = [
  ["fl", "Front left"],
  ["fr", "Front right"],
  ["rl", "Rear left"],
  ["rr", "Rear right"],
] as const;
const UPDATE: Record<string, string> = {
  available: "Ready to download",
  downloading: "Downloading",
  waiting_for_wifi: "Waiting for Wi-Fi",
  scheduled: "Scheduled",
  installing: "Installing",
};

/** When a group was read, in a few words: "read 9:42", or a day and time when it's older than today. */
function readAt(as_of: number | null, now: number): string {
  if (!as_of) return "Not read yet";
  const today = sameDay(now, as_of);
  return today ? `Read ${hhmm(as_of)}` : `Read ${shortDay.format(as_of * 1000)}, ${hhmm(as_of)}`;
}

/** One group's card: its rows once it's been read, why not when the car won't share it, and when it was read. */
function Group<T>({
  title,
  group,
  now,
  free,
  className,
  children,
}: {
  title: string;
  group: DetailGroup<T> | undefined;
  now: number;
  /** Read without waking the car (its security computer, or Tessie's copy). */
  free?: boolean;
  className?: string;
  children: (data: T) => ReactNode;
}) {
  return (
    <section
      className={cn("flex min-w-0 flex-col rounded-xl border border-line-subtle bg-fg/3 px-3 py-2.5", className)}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 text-sm font-semibold">{title}</h3>
        <span
          className="text-xs whitespace-nowrap text-ink-faint tabular-nums"
          title={free ? "Read without waking the car" : undefined}
        >
          {group ? readAt(group.as_of, now) : "Not read yet"}
          {free && group?.as_of ? " · live" : ""}
        </span>
      </div>
      {!group && (
        <p className="m-0 mt-2 text-[13px] text-ink-muted">
          Fills in next time the car's awake, or when you tap Refresh.
        </p>
      )}
      {group?.refused && <p className="m-0 mt-2 text-[13px] text-ink-muted">{group.refused}.</p>}
      {group?.data && <div className="[&>div:last-child]:border-b-0">{children(group.data)}</div>}
    </section>
  );
}

function scheduleWhen(mode: string, start: number | null, depart: number | null): string {
  if (mode === "start_at" && start != null) return `Starts at ${minutesLabel(start)}`;
  if (mode === "depart_by" && depart != null) return `Ready to leave by ${minutesLabel(depart)}`;
  return "Off";
}

function update(u: SoftwareUpdate | null): string {
  if (!u) return "Up to date";
  const what = UPDATE[u.status] ?? u.status;
  const pc = u.status === "downloading" ? u.download_pct : u.status === "installing" ? u.install_pct : null;
  const when = u.status === "scheduled" && u.scheduled_at ? ` for ${hhmm(u.scheduled_at)}` : "";
  return [u.version, `${what}${pc != null ? ` (${pc}%)` : ""}${when}`].filter(Boolean).join(": ");
}

const COP: Record<string, string> = { on: "On", fan_only: "Fan only", off: "Off" };

/** What's using power while it's parked is worked out from its climate and security: read when the newer of them was. */
function parked(g: Partial<EvDetailGroups>): DetailGroup<object> | undefined {
  const at = [g.climate, g.security].filter((x) => x?.data).map((x) => x?.as_of ?? 0);
  return at.length ? { as_of: Math.max(...at), data: {} } : undefined;
}

function Groups({ d, now }: { d: Details; now: number }) {
  const g: Partial<EvDetailGroups> = d.groups;
  return (
    <div className="flex flex-col gap-2.5">
      <Group title="Doors and security" group={g.status} now={now} free>
        {(s) => (
          <>
            <DataRow label="Locked">{yes(s.locked)}</DataRow>
            <DataRow label="Open">{list(s.open, "All shut")}</DataRow>
            <DataRow label="Someone in it">{yes(s.user_present)}</DataRow>
            {g.security?.data && (
              <>
                <DataRow label="Windows open">{list(g.security.data.windows_open, "None")}</DataRow>
                <DataRow label="Sentry mode">{g.security.data.sentry ?? "—"}</DataRow>
                {g.security.data.valet && <DataRow label="Valet mode">On</DataRow>}
              </>
            )}
          </>
        )}
      </Group>
      <Group title="Using power while parked" group={parked(g)} now={now}>
        {() => (
          <>
            <DataRow label="Now">{list(d.parked_draw, "Nothing")}</DataRow>
            {g.climate?.data && (
              <DataRow label="Cabin overheat protection">{COP[g.climate.data.cabin_overheat ?? ""] ?? "—"}</DataRow>
            )}
            {g.security?.data && <DataRow label="Sentry mode">{g.security.data.sentry ?? "—"}</DataRow>}
          </>
        )}
      </Group>
      <Group title="Charging" group={g.charging} now={now}>
        {(c) => (
          <>
            <DataRow label="The charger offers">{c.pilot_amps ? `${c.pilot_amps} A` : "—"}</DataRow>
            <DataRow label="Cable">{c.cable ?? "—"}</DataRow>
            <DataRow label="Port latch">{c.latch ?? "—"}</DataRow>
            <DataRow label="Time to limit">
              {c.minutes_to_limit ? `${Math.floor(c.minutes_to_limit / 60)} h ${c.minutes_to_limit % 60} min` : "—"}
            </DataRow>
            <DataRow label="Usable charge">{pct(c.usable_soc)}</DataRow>
            <DataRow label="Added this charge">{c.energy_added != null ? `${c.energy_added} kWh` : "—"}</DataRow>
          </>
        )}
      </Group>
      <Group title="Schedules in the car" group={g.schedule} now={now}>
        {(s) => (
          <>
            <DataRow label="Scheduled charging">{scheduleWhen(s.mode, s.start_minutes, s.departure_minutes)}</DataRow>
            {s.charge_schedules?.map((c, i) => (
              <DataRow key={`c${i}`} label={c.name ?? "Charge schedule"} muted={!c.enabled}>
                {c.days.length === 7 ? "Every day" : c.days.join(" ")} {c.start != null ? minutesLabel(c.start) : ""}
                {c.end != null ? `–${minutesLabel(c.end)}` : ""}
                {!c.enabled && " (off)"}
              </DataRow>
            ))}
            {s.precondition_schedules?.map((c, i) => (
              <DataRow key={`p${i}`} label={c.name ?? "Preconditioning"} muted={!c.enabled}>
                {c.days.join(" ")} {c.time != null ? minutesLabel(c.time) : ""}
                {!c.enabled && " (off)"}
              </DataRow>
            ))}
            {s.charge_schedules === null && (
              <DataRow label="Charge schedules" muted>
                Not read yet
              </DataRow>
            )}
          </>
        )}
      </Group>
      <Group title="Climate" group={g.climate} now={now}>
        {(c) => (
          <>
            <DataRow label="Inside">{temp(c.inside_c)}</DataRow>
            <DataRow label="Outside">{temp(c.outside_c)}</DataRow>
            <DataRow label="Climate">{yes(c.climate_on, "On", "Off")}</DataRow>
            <DataRow label="Preconditioning">{yes(c.preconditioning, "On", "Off")}</DataRow>
            {c.keeper && <DataRow label="Keeper mode">{c.keeper}</DataRow>}
            <DataRow label="Battery heater">{yes(c.battery_heater, "On", "Off")}</DataRow>
          </>
        )}
      </Group>
      <Group title="Tyres" group={g.tyres} now={now}>
        {(t) => (
          <>
            {TYRES.map(([k, label]) => (
              <DataRow key={k} label={label}>
                <span className={cn(t.warnings.includes(k) && "text-warn")}>
                  {psi(t[k])}
                  {t.warnings.includes(k) && " · check"}
                </span>
              </DataRow>
            ))}
          </>
        )}
      </Group>
      <Group title="Driving" group={g.driving} now={now}>
        {(r) => (
          <>
            <DataRow label="Odometer">
              {r.odometer_km != null ? `${Math.round(r.odometer_km).toLocaleString("en-AU")} km` : "—"}
            </DataRow>
            <DataRow label="Gear">{r.gear ?? "—"}</DataRow>
            {r.speed_kmh ? <DataRow label="Speed">{Math.round(r.speed_kmh)} km/h</DataRow> : null}
          </>
        )}
      </Group>
      <Group title="Software" group={g.software} now={now}>
        {(s) => (
          <>
            <DataRow label="Version">{s.version ?? "—"}</DataRow>
            <DataRow label="Update">{update(s.update)}</DataRow>
          </>
        )}
      </Group>
      <Group title="Media" group={g.media} now={now}>
        {(m) => (
          <DataRow label={m.playing ? "Playing" : "Nothing playing"} muted={!m.playing}>
            {m.playing ? [m.title, m.artist].filter(Boolean).join(" · ") || m.source || "—" : ""}
          </DataRow>
        )}
      </Group>
    </div>
  );
}

/** Its tyres in a few words: all fine, or which to check. */
function tyres(d: Details): string | null {
  const t = d.groups.tyres?.data;
  if (!t) return null;
  const check = TYRES.filter(([k]) => t.warnings.includes(k)).map(([, label]) => label.toLowerCase());
  return check.length ? `Check ${check.join(", ")}` : "All fine";
}

/**
 * The car itself, as a small card: where it is between asleep, awake and charging, what it's doing in a sentence (and
 * while it waits for spare solar, how closely it's followed), how fresh that is, a few facts about it (odometer, locks,
 * cabin, tyres, software), and one button to read it now (waking it when it's asleep: the button says so) or hand it
 * back to the dashboard. Everything else it says about itself is folded away under "Everything else", group by group.
 */
export function EvCar({ v, provider, className }: { v: EvVehicle; provider: Reached | null; className?: string }) {
  const now = useNow(30_000);
  const { data: d, error } = useQuery(detailsQuery(v.vin));
  const refresh = useRefreshDetails();
  const { command } = useEvChange("tesla");
  const [open, setOpen] = useState(false);
  const s = v.state;
  const mood = carMood({ status: v.status, mode: v.control.mode, asleep: s?.asleep, charging: s?.charging });
  const ready = readiness(v, provider);
  const g: Partial<EvDetailGroups> = d?.groups ?? {};
  const odometer = g.driving?.data?.odometer_km ?? null;
  const asleep = !!s?.asleep && s.in_range !== false;
  return (
    <SmallCard
      id={`h-td-${v.vin}`}
      title={v.name ?? carTitle(v)}
      note={[v.year, v.name ? carTitle(v) : null].filter(Boolean).join(" · ") || undefined}
      className={className}
    >
      <CarSteps
        step={mood.step}
        color={mood.color}
        detail={mood.step === "charging" && s?.power_kw ? kW(s.power_kw * 1000) : null}
      />
      <div className="flex flex-col gap-0.5">
        <span className="text-sm text-pretty">{v.doing}</span>
        {ready && <span className="text-[13px] text-pretty text-ink-muted">{ready}</span>}
        <span className="text-xs text-ink-faint tabular-nums">{freshness(v, provider)}</span>
      </div>
      <Facts
        rows={[
          odometer != null && ["Odometer", `${Math.round(odometer).toLocaleString("en-AU")} km`],
          g.status?.data?.locked != null && ["Locked", yes(g.status.data.locked)],
          g.climate?.data?.inside_c != null && ["Inside", temp(g.climate.data.inside_c)],
          d && tyres(d) != null && ["Tyres", tyres(d)],
          g.software?.data && [
            "Software",
            update(g.software.data.update) === "Up to date"
              ? (g.software.data.version ?? "Up to date")
              : update(g.software.data.update),
          ],
          g.charging?.data?.pilot_amps != null && ["The charger offers", `${g.charging.data.pilot_amps} A`],
        ]}
      />
      {d?.overrides_solar && (
        <Notice tone="warn">
          {d.overrides_solar}. When it does, the dashboard leaves it charging and takes over again once it's unplugged.
          Turn it off in the car (Charging → Schedule) to charge from spare solar only.
        </Notice>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          variant="outline"
          size="sm"
          disabled={refresh.isPending || s?.in_range === false}
          title={asleep ? "Wakes it and reads it now. It stays awake a while after." : "Reads everything now"}
          onClick={() => refresh.mutate({ vin: v.vin, wake: asleep })}
        >
          {refresh.isPending ? (asleep ? "Waking the car…" : "Reading…") : asleep ? "Wake and read" : "Refresh"}
        </Button>
        {v.hold && v.control.mode !== "off" && (
          <Button
            size="sm"
            variant="outline"
            disabled={command.isPending}
            onClick={() => command.mutate({ vin: v.vin, action: "resume" })}
          >
            Let the dashboard take over
          </Button>
        )}
        <Button
          variant="muted-link"
          size="sm"
          aria-expanded={open}
          aria-controls={`more-${v.vin}`}
          className="ml-auto"
          onClick={() => setOpen(!open)}
        >
          {open ? "Less" : "Everything else"}
        </Button>
      </div>
      {(refresh.isError || command.isError || error) && (
        <HelpText tone="bad">{errorMessage(refresh.error ?? command.error ?? error)}</HelpText>
      )}
      {refresh.isSuccess && asleep && <HelpText>Woken and read. It stays awake a while, then sleeps again.</HelpText>}
      <Collapse open={open} id={`more-${v.vin}`} className="flex flex-col gap-3 pt-1">
        <CardText>
          {d?.provider === "bluetooth"
            ? "Read every 15 minutes while the car's awake. It's never woken just for these."
            : "From Tessie's latest read. The car's never woken just for these."}
        </CardText>
        {d && <Groups d={d} now={now} />}
      </Collapse>
    </SmallCard>
  );
}
