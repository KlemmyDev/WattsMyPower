import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiError, errorMessage } from "~/features/common/api/utils";
import { hhmm, minutesLabel, shortDay } from "~/features/common/formatting/utils/date";
import { sameDay } from "~/features/common/time/utils";
import { pct } from "~/features/common/formatting/utils/number";
import { useNow } from "~/features/common/time/hooks";
import { Button } from "~/features/common/ui/components/Button";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { DataRow } from "~/features/common/ui/components/DataRow";
import { HelpText } from "~/features/common/ui/components/Field";
import { Notice } from "~/features/common/ui/components/Notice";
import { cn } from "~/features/common/ui/utils";
import { detailsQuery } from "~/features/ev/api";
import { useRefreshDetails } from "~/features/ev/hooks";
import type { DetailGroup, EvDetailGroups, EvDetails as Details, SoftwareUpdate } from "~/features/ev/types";

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
    <section className={cn("flex min-w-0 flex-col rounded-2xl border border-line-subtle p-4", className)}>
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
        <p className="m-0 mt-2 text-[13px] text-ink-muted">Read the next time the car's awake, or with Refresh.</p>
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
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] gap-3">
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
            <DataRow label="To its limit">
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

/**
 * Everything else the car says about itself, group by group, each with when it was read. Its status (locked, doors,
 * someone in it) is read without waking it; the rest only while it's awake (over Bluetooth every 15 minutes, through
 * Tessie as Tessie has it). Refresh reads it all now, and asks first when that would wake the car.
 */
export function EvDetails({ vin, name, className }: { vin: string; name: string; className?: string }) {
  const now = useNow(30_000);
  const { data: d, error, isPending } = useQuery(detailsQuery(vin));
  const refresh = useRefreshDetails();
  const [asking, setAsking] = useState(false);
  const run = (wake: boolean) =>
    refresh.mutate(
      { vin, wake },
      {
        onSuccess: () => setAsking(false),
        // Asleep after all (it fell asleep since): ask.
        onError: (e) => e instanceof ApiError && e.status === 409 && !wake && setAsking(true),
      },
    );
  const sleepy = !!d?.refresh_wakes;
  const askingNow = asking || (refresh.isError && refresh.error instanceof ApiError && refresh.error.status === 409);

  return (
    <Card aria-labelledby={`h-td-${vin}`} className={cn("gap-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <TitleBlock
          id={`h-td-${vin}`}
          title="Car details"
          sub={
            d?.provider === "bluetooth"
              ? "Read while the car's awake, every 15 minutes; never woken just for these"
              : "As Tessie last had them; never woken just for these"
          }
        />
        {!askingNow && (
          <Button
            variant="outline"
            size="sm"
            disabled={refresh.isPending || !d}
            onClick={() => (sleepy ? setAsking(true) : run(false))}
            title={sleepy ? "The car's asleep: you'll be asked before it's woken" : "Read everything now"}
          >
            {refresh.isPending ? "Reading…" : sleepy ? "Refresh…" : "Refresh"}
          </Button>
        )}
      </div>
      {askingNow && (
        <Notice tone="warn" className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 flex-1 text-pretty">
            <b className="font-semibold">{name} is asleep.</b> Reading its details wakes it, and it then stays awake for
            a while, using a little power. Its locks and doors (below) are already current.
          </span>
          <span className="flex items-center gap-3">
            <Button size="sm" disabled={refresh.isPending} onClick={() => run(true)}>
              {refresh.isPending ? "Waking…" : "Wake and refresh"}
            </Button>
            <Button
              variant="muted-link"
              size="sm"
              onClick={() => {
                setAsking(false);
                refresh.reset();
              }}
            >
              Cancel
            </Button>
          </span>
        </Notice>
      )}
      {refresh.isError && !(refresh.error instanceof ApiError && refresh.error.status === 409) && (
        <HelpText tone="bad">{errorMessage(refresh.error)}</HelpText>
      )}
      {d?.overrides_solar && (
        <Notice tone="warn">
          {d.overrides_solar}. When it does, the dashboard leaves it charging and puts it on hold until it's unplugged.
          Turn it off in the car (Charging → Schedule) to charge from spare solar only.
        </Notice>
      )}
      {isPending && <p className="m-0 text-sm text-ink-muted">Loading…</p>}
      {error && <p className="m-0 text-sm text-bad">{errorMessage(error)}</p>}
      {d && <Groups d={d} now={now} />}
    </Card>
  );
}
