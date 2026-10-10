import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { sessionQuery } from "~/features/auth/api";
import { locationLabel } from "~/features/common/energy/utils";
import { hhmm, monthYear } from "~/features/common/formatting/utils/date";
import { dollars, pct } from "~/features/common/formatting/utils/number";
import { useLiveStatus } from "~/features/common/layout/hooks";
import { useLive } from "~/features/common/live/hooks/useLive";
import type { SystemInfo } from "~/features/common/live/types";
import { inverterName } from "~/features/common/live/utils";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Pill } from "~/features/common/ui/components/Pill";
import { cn } from "~/features/common/ui/utils";
import { HouseScene } from "~/features/overview/components/HouseScene";
import { houseOptions } from "~/features/overview/utils/house/options";
import { HOUSE_STYLES, THUMB_FLOWS } from "~/features/settings/components/HouseSettings";
import { SettingsGroup, SettingsRow } from "~/features/settings/components/SettingsList";
import { updatesQuery } from "~/features/updates/api";
import { ChannelDot } from "~/features/updates/components/ChannelBadge";
import { CHANNEL } from "~/features/updates/utils";

const join = (parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" · ");

/** "Sungrow SH5.0RS hybrid and SG5K-D", or what's known of it. */
function inverters(s: SystemInfo | undefined): string {
  if (!s?.model) return "Your solar and battery system";
  const main = `${inverterName(s)} hybrid`;
  return s.pv2?.model ? `${main} and ${s.pv2.model}` : main;
}

function solarBattery(s: SystemInfo | undefined) {
  if (!s) return "";
  return (
    join([
      s.pv_kw ? `${s.pv_kw} kW of panels` : "Array size not set",
      s.battery_kwh ? `${s.battery_kwh} kWh battery` : null,
      s.battery_kwh && s.battery_reserve != null ? `${pct(s.battery_reserve)} reserve` : null,
    ]) || "Array size, battery and its rates"
  );
}

function costWarranty(s: SystemInfo | undefined) {
  if (!s) return "";
  return (
    join([
      s.system_cost ? `${dollars(s.system_cost)}` : null,
      s.system_installed ? `installed ${monthYear.format(new Date(s.system_installed * 1000))}` : null,
      s.battery_warranty_years ? `${s.battery_warranty_years}-year battery warranty` : null,
    ]) || "Optional: for payback, and the battery's warranty"
  );
}

function house(s: SystemInfo | undefined) {
  if (!s) return "";
  const h = houseOptions(s);
  return join([
    HOUSE_STYLES.find((st) => st.value === h.style)?.name,
    h.storeys === 2 ? "double storey" : "single storey",
    h.garage ? `${h.garage === 2 ? "double" : "single"} garage` : null,
  ]);
}

/** The top of the page: the house as the Overview draws it, the inverters, where it is and whether it's reading. */
function SystemSummary() {
  const live = useLive();
  const s = live?.system;
  const { state } = useLiveStatus();
  const last = live?.last_success;
  return (
    <section
      aria-labelledby="h-system-summary"
      className="glass flex items-center gap-5 overflow-hidden rounded-3xl border border-line-subtle p-4 pr-6 max-sm:gap-3.5 max-sm:rounded-[20px] max-sm:p-3"
    >
      <Link
        to="/system/house"
        aria-label="Your house"
        className="relative aspect-[2/1] w-[220px] flex-none overflow-hidden rounded-2xl bg-[#dcebff] max-sm:aspect-square max-sm:w-[92px] max-sm:rounded-xl"
      >
        <HouseScene flows={THUMB_FLOWS} sky="sunny" house={houseOptions(s)} />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-1 max-sm:gap-0.5">
        <h2
          id="h-system-summary"
          className="text-xl leading-7 font-semibold text-pretty max-sm:text-base max-sm:leading-6"
        >
          {inverters(s)}
        </h2>
        <span className="text-sm text-ink-muted max-sm:text-[13px]">
          {join([locationLabel(s) === "your location" ? null : locationLabel(s), s?.phases])}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-muted max-sm:mt-1">
          <span
            aria-hidden
            className={cn(
              "size-2 flex-none rounded-full",
              state === "live" ? "bg-good" : state === "stale" ? "bg-warn" : "bg-bad",
            )}
          />
          {state === "live" ? "Reading live" : state === "stale" ? "No new readings" : "Not reading"}
          {last ? ` · last read ${hhmm(last)}` : ""}
        </span>
      </div>
    </section>
  );
}

function UpdatesRow() {
  const { data: u } = useQuery(updatesQuery);
  const app = useLive()?.app;
  const version = u?.current.version ?? app?.version;
  const channel = u && (
    <span className="inline-flex items-center gap-1.5">
      <ChannelDot channel={u.channel} />
      {CHANNEL[u.channel].label} channel
    </span>
  );
  return (
    <SettingsRow
      to="/system/updates"
      icon="download"
      color={COLOR.export}
      label="Updates"
      detail={
        version ? (
          <>
            v{version}
            {channel && <> · {channel}</>}
          </>
        ) : (
          "The version you're running"
        )
      }
      aside={
        u?.available ? (
          <Pill tone="brand" size="sm">
            Update available
          </Pill>
        ) : u?.latest && u.move !== "older" ? (
          <Pill tone="ok" size="sm">
            Up to date
          </Pill>
        ) : null
      }
    />
  );
}

function AccountRow() {
  const { data: session } = useQuery(sessionQuery);
  return (
    <SettingsRow
      to="/account"
      icon="user"
      color={COLOR.lilac}
      label="Account and appearance"
      detail={session?.username ? `Signed in as ${session.username}` : "Theme, text size and layout"}
    />
  );
}

/**
 * Manage → System: a list of what can be set, grouped, each opening its own page. Your system (the solar and
 * battery, where it is, what it cost, the house the Overview draws), the dashboard (account, integrations, data), and
 * WattsMyPower itself (updates, and the set-up guide again).
 */
export function SystemHub() {
  const s = useLive()?.system;
  return (
    <>
      <SystemSummary />
      <div className="@container">
        <div className="grid grid-cols-1 items-start gap-6 @3xl:grid-cols-2">
          <SettingsGroup id="h-group-system" title="Your system">
            <SettingsRow
              to="/system/solar-battery"
              icon="sun"
              color={COLOR.solarDeep}
              label="Solar and battery"
              detail={solarBattery(s)}
            />
            <SettingsRow
              to="/system/location"
              icon="pin"
              color={COLOR.teal}
              label="Location"
              detail={locationLabel(s) === "your location" ? "Not set" : locationLabel(s)}
            />
            <SettingsRow
              to="/system/cost"
              icon="dollar"
              color={COLOR.good}
              label="Cost and warranty"
              detail={costWarranty(s)}
            />
            <SettingsRow to="/system/house" icon="home" color={COLOR.brand} label="Your house" detail={house(s)} />
          </SettingsGroup>
          <div className="flex min-w-0 flex-col gap-6">
            <SettingsGroup id="h-group-dashboard" title="Dashboard">
              <AccountRow />
              <SettingsRow
                to="/integrations"
                icon="plug"
                color={COLOR.battery}
                label="Integrations"
                detail="Inverters, smart home, cars, prices and weather"
              />
              <SettingsRow
                to="/data"
                icon="database"
                color={COLOR.import}
                label="Data"
                detail="What's stored, and how much room it takes"
              />
            </SettingsGroup>
            <SettingsGroup id="h-group-app" title="WattsMyPower">
              <UpdatesRow />
              <SettingsRow
                to="/welcome"
                icon="check"
                color={COLOR.warn}
                label="Set-up guide"
                detail="Your inverter, plan, location and billing, step by step"
              />
            </SettingsGroup>
          </div>
        </div>
      </div>
    </>
  );
}
