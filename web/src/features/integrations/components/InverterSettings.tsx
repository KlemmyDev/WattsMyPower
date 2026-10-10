import { errorMessage } from "~/features/common/api/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { useLive } from "~/features/common/live/hooks/useLive";
import { COLOR } from "~/features/common/theme/utils/colors";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { SummaryCard, SummaryStat } from "~/features/common/ui/components/Summary";
import { ReadOnlyNote } from "~/features/integrations/components/ConnectedInverters";
import { IntegrationLink } from "~/features/integrations/components/IntegrationLink";
import { ReachTag, UntestedTag } from "~/features/integrations/components/ReachTag";
import { useInverters } from "~/features/integrations/hooks";
import type { InverterKind } from "~/features/integrations/types";
import { deviceAddress, ROLE_DETAIL, ROLE_NAME } from "~/features/integrations/utils";
import { SettingsSection } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

/** How to get each brand's inverter answering on the network, for the brands' list. */
const SETUP: Record<string, string> = {
  Sungrow:
    "Through its WiNet-S or WiNet-S2 dongle (or the inverter's own network port), over Modbus TCP. Nothing to turn on.",
  GoodWe:
    "Through its Wi-Fi or LAN dongle, over Modbus on UDP port 8899 (newer LAN dongles take Modbus TCP on 502 too). Nothing to turn on.",
  Fronius:
    "Through its Solar API on the inverter's network port. A GEN24 ships with it off: turn it on in the inverter's web page, under Communication → Solar API. A main inverter needs a Fronius Smart Meter.",
};

/** One brand the collector reads: its families, how it's reached, whether it's been tried, and connecting one. */
function Brand({ brand, kinds, canConnect }: { brand: string; kinds: InverterKind[]; canConnect: boolean }) {
  const verified = kinds.every((k) => k.verified !== false);
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-canvas/60 p-5 light:bg-canvas">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[15px] font-semibold">{brand}</span>
        <span className="flex items-center gap-3">
          <ReachTag reach="local" />
          {!verified && <UntestedTag />}
        </span>
      </div>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] text-ink-muted">
        {kinds.map((k) => (
          <li key={k.driver}>
            <span className="text-ink">{k.label}</span> · as the {ROLE_NAME[k.role]} · e.g. {k.example}
          </li>
        ))}
      </ul>
      {SETUP[brand] && <p className="m-0 text-xs leading-5 text-pretty text-ink-faint">{SETUP[brand]}</p>}
      {canConnect && (
        <ButtonLink
          to="/integrations/inverters/connect"
          search={{ brand }}
          variant="outline"
          size="sm"
          className="mt-auto self-start"
        >
          Connect a {brand}
        </ButtonLink>
      )}
    </div>
  );
}

/**
 * Manage → Integrations → Inverters: what's connected at the top, the inverters WattsMyPower reads (each opening to
 * its own page), the brands it can read and how, and importing history from iSolarCloud.
 */
export function InverterSettings() {
  const { data, isPending, error, inverters } = useInverters();
  const live = useLive();
  const main = inverters.find((i) => i.hybrid);
  const second = inverters.find((i) => !i.hybrid);
  const readOnly = data?.read_only ?? true;
  const canConnect = !!data?.available && !readOnly;
  const kinds = data?.kinds ?? [];
  const brands = [...new Set(kinds.map((k) => k.brand))];
  const sungrow = !inverters.length || inverters.some((i) => i.device.brand === "Sungrow");

  return (
    <>
      <SubPageHeader
        back={<BackLink to="/integrations">Integrations</BackLink>}
        id="h-inverters"
        title="Inverters"
        sub="Read every minute over your home network, straight from each inverter, with no cloud in between."
      />
      <SummaryCard
        icon="sun"
        color={COLOR.solar}
        label="Your inverters"
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-4 text-[13px] text-ink-muted">
            <span className="min-w-0 flex-1">
              {isPending
                ? "Checking what's connected…"
                : error
                  ? errorMessage(error)
                  : data && !data.available
                    ? data.error
                    : !main
                      ? "Nothing is recorded until your main inverter (with the meter, and the battery if there is one) is connected."
                      : main.frozen
                        ? `Readings frozen since ${hhmm(main.frozen)}: the dongle isn't refreshing them.`
                        : main.last
                          ? `Last read at ${hhmm(main.last)}, every ${live?.poll_interval ?? 60} seconds.`
                          : "Waiting for its first reading."}
            </span>
            {canConnect && (
              <ButtonLink to="/integrations/inverters/connect" variant={main ? "outline" : "primary"} size="sm">
                {main ? "Add an inverter" : "Find your inverter"}
              </ButtonLink>
            )}
          </div>
        }
      >
        <SummaryStat
          label="Main inverter"
          value={main?.name ?? "None yet"}
          sub={main ? [main.device.brand, main.status].filter(Boolean).join(" · ") : "With the meter and battery"}
        />
        <SummaryStat
          label="Second inverter"
          value={second?.name ?? "None"}
          sub={second ? (second.device.behind_meter ? "Behind the main meter" : "Counted as export") : "Optional"}
        />
        <SummaryStat
          label="Status"
          value={main?.status ?? "Not connected"}
          color={main && !main.on ? COLOR.warn : undefined}
          sub={main?.reading}
        />
        <SummaryStat label="Brands it reads" value={brands.length || "—"} sub={brands.join(", ")} />
      </SummaryCard>

      <SettingsSection
        id="h-connected"
        title="Connected"
        sub="Each one's page has what it reported about itself, how it's wired, and removing it."
      >
        {(inverters.length > 0 || (data?.available && readOnly)) && (
          <div className="overflow-hidden rounded-2xl bg-canvas/60 light:bg-canvas">
            {inverters.map(({ device, name, hybrid, status, on, reading }) => (
              <IntegrationLink
                key={device.role}
                to="/integrations/inverters/$role"
                params={{ role: device.role }}
                icon={hybrid ? "battery" : "sun"}
                name={name}
                status={status}
                on={on}
                detail={
                  <>
                    {ROLE_DETAIL[device.role]}
                    <span className="block text-xs text-ink-faint tabular-nums">
                      At {deviceAddress(device)} · {reading}
                    </span>
                  </>
                }
                tags={device.verified === false ? <UntestedTag /> : undefined}
              />
            ))}
            {data?.available && readOnly && <ReadOnlyNote />}
          </div>
        )}
        {!inverters.length && !isPending && (
          <p className="m-0 text-sm text-ink-muted">
            None yet.{" "}
            {canConnect
              ? "Find yours with a quick scan of your network, or enter its address."
              : "Connect one from the server that runs the collector."}
          </p>
        )}
      </SettingsSection>

      {brands.length > 0 && (
        <SettingsSection
          id="h-brands"
          title="Brands it reads"
          sub="Each read on your home network. Untested ones follow what their maker documents and haven't been tried on a real one yet: if you have one, how it reads (or doesn't) gets it checked."
        >
          <div className="grid gap-3 xl:grid-cols-3">
            {brands.map((b) => (
              <Brand key={b} brand={b} kinds={kinds.filter((k) => k.brand === b)} canConnect={canConnect} />
            ))}
          </div>
        </SettingsSection>
      )}

      {sungrow && (
        <SettingsSection id="h-history" title="History" sub="For Sungrow inverters">
          <div className="overflow-hidden rounded-2xl bg-canvas/60 light:bg-canvas">
            <IntegrationLink
              to="/integrations/inverters/import"
              icon="upload"
              name="Import history from iSolarCloud"
              detail="Bring in the days before WattsMyPower was set up, or fill gaps, from iSolarCloud's 5-minute exports"
            />
          </div>
        </SettingsSection>
      )}
    </>
  );
}
