import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
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
import {
  asRole,
  BRAND_ABOUT,
  brandSlug,
  deviceAddress,
  ROLE_DETAIL,
  ROLE_NAME,
  type InverterState,
} from "~/features/integrations/utils";
import { SettingsSection } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

/** Each brand the collector reads: its families, whether they've been tried on a real one, and its inverters
 * connected now. */
type Brand = { name: string; slug: string; kinds: InverterKind[]; verified: boolean; inverters: InverterState[] };

function useBrands(): Brand[] {
  const { data, inverters } = useInverters();
  const names = [...new Set([...(data?.kinds ?? []).map((k) => k.brand), ...inverters.map((i) => i.device.brand)])];
  return names
    .filter((n): n is string => !!n)
    .map((name) => {
      const kinds = (data?.kinds ?? []).filter((k) => k.brand === name);
      return {
        name,
        slug: brandSlug(name),
        kinds,
        verified: kinds.every((k) => k.verified !== false),
        inverters: inverters.filter((i) => i.device.brand === name),
      };
    });
}

/** What a brand's inverters are doing, in a pill: one needing a look says so; otherwise Connected once any answers
 * (a second inverter asleep after dark is only waiting). */
function brandStatus(inverters: InverterState[]): { status: string; on: boolean; attention: boolean } {
  if (!inverters.length) return { status: "", on: false, attention: false };
  const trouble = inverters.find((i) => !i.on && i.status !== "Connecting" && (i.hybrid || i.status === "Frozen"));
  if (trouble) return { status: trouble.status, on: false, attention: true };
  if (inverters.some((i) => i.on)) return { status: "Connected", on: true, attention: false };
  return { status: inverters[0].status, on: false, attention: false };
}

/** An inverter as a row, opening to its own page under its brand. */
function InverterRow({ inverter: { device, name, status, on, reading, hybrid } }: { inverter: InverterState }) {
  return (
    <IntegrationLink
      to="/integrations/inverters/$brand/$role"
      params={{ brand: brandSlug(device.brand), role: device.role }}
      icon={hybrid ? "battery" : "sun"}
      name={name}
      status={status}
      on={on}
      attention={!on && status !== "Connecting"}
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
  );
}

/** A brand's inverters at a glance: its main and second inverter, how they're doing, and connecting one. */
function Summary({ brand }: { brand: Brand }) {
  const { data, isPending, error, inverters } = useInverters();
  const live = useLive();
  const shown = brand.inverters;
  const main = shown.find((i) => i.hybrid);
  const second = shown.find((i) => !i.hybrid);
  const canConnect = !!data?.available && !data.read_only;
  const anyMain = inverters.some((i) => i.hybrid);
  return (
    <SummaryCard
      icon="sun"
      color={main && !main.on ? COLOR.warn : COLOR.solar}
      label={`Your ${brand.name} inverters`}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-4 text-[13px] text-ink-muted">
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span>
              {isPending
                ? "Checking what's connected…"
                : error
                  ? errorMessage(error)
                  : data && !data.available
                    ? data.error
                    : !shown.length
                      ? `No ${brand.name} inverter is connected.`
                      : !main
                        ? `A second inverter: the main one is ${inverters.find((i) => i.hybrid)?.name ?? "not connected yet"}.`
                        : main.frozen
                          ? `Readings frozen since ${hhmm(main.frozen)}: the dongle isn't refreshing them.`
                          : main.last
                            ? `Last read at ${hhmm(main.last)}, every ${live?.poll_interval ?? 60} seconds.`
                            : "Waiting for its first reading."}
            </span>
            <span className="flex flex-wrap gap-3">
              <ReachTag reach="local" />
              {!brand.verified && <UntestedTag />}
            </span>
          </span>
          {canConnect && (
            <ButtonLink
              to="/integrations/inverters/$brand/connect"
              params={{ brand: brand.slug }}
              variant={anyMain ? "outline" : "primary"}
              size="sm"
            >
              {anyMain ? `Add a ${brand.name}` : `Connect a ${brand.name}`}
            </ButtonLink>
          )}
        </div>
      }
    >
      <SummaryStat
        label="Main inverter"
        value={main?.name ?? "None"}
        sub={main ? main.status : "With the meter and battery"}
      />
      <SummaryStat
        label="Second inverter"
        value={second?.name ?? "None"}
        sub={second ? (second.device.behind_meter ? "Behind the main meter" : "Counted as export") : "Optional"}
      />
      <SummaryStat
        label="Status"
        value={main?.status ?? second?.status ?? "Not connected"}
        color={(main ?? second) && !(main ?? second)?.on ? COLOR.warn : undefined}
        sub={(main ?? second)?.reading}
      />
      <SummaryStat label="It reads" value={brand.kinds.length} sub={brand.kinds.map((k) => k.label).join(", ")} />
    </SummaryCard>
  );
}

/**
 * Manage → Integrations → Inverters: each brand WattsMyPower reads (connected first), saying how its inverters are
 * doing, each opening to its own page: its inverters, connecting one, and anything only that brand has.
 */
export function InverterSettings() {
  const { data, isPending, error } = useInverters();
  const brands = useBrands();
  const order = [...brands.filter((b) => b.inverters.length), ...brands.filter((b) => !b.inverters.length)];
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/integrations">Integrations</BackLink>}
        id="h-inverters"
        title="Inverters"
        sub="Read every minute over your home network, straight from each inverter, with no cloud in between."
      />
      {isPending && <p className="m-0 text-sm text-ink-muted">Checking what's connected…</p>}
      {error && <p className="m-0 text-sm text-bad">{errorMessage(error)}</p>}
      {data && !data.available && <p className="m-0 text-sm leading-[22px] text-ink-muted">{data.error}</p>}
      <SettingsSection
        id="h-brands"
        title="Brands"
        sub="One main inverter (with the meter, and the battery if there is one) and an optional second, AC-coupled one, of any brand here. Open yours to connect it."
      >
        {order.length > 0 && (
          <div className="overflow-hidden rounded-2xl bg-canvas/60 light:bg-canvas">
            {order.map((b) => {
              const s = brandStatus(b.inverters);
              return (
                <IntegrationLink
                  key={b.slug}
                  to="/integrations/inverters/$brand"
                  params={{ brand: b.slug }}
                  icon="sun"
                  name={b.name}
                  status={s.status || undefined}
                  on={s.on}
                  attention={s.attention}
                  detail={
                    <span className="line-clamp-2">
                      {b.inverters.length
                        ? b.inverters.map((i) => `${i.name} (${ROLE_NAME[i.device.role]})`).join(", ")
                        : (BRAND_ABOUT[b.name]?.about ?? b.kinds.map((k) => k.label).join(", "))}
                    </span>
                  }
                  tags={
                    <>
                      <ReachTag reach="local" />
                      {!b.verified && <UntestedTag />}
                    </>
                  }
                />
              );
            })}
          </div>
        )}
        {!isPending && data?.available && data.read_only && <ReadOnlyNote />}
      </SettingsSection>
    </>
  );
}

/**
 * Manage → Integrations → Inverters → a brand: its inverters connected now (each opening to its own page), what of it
 * WattsMyPower reads and how to get one answering, and what only that brand has (a Sungrow's history from
 * iSolarCloud). Old links to an inverter by its role alone (/integrations/inverters/hybrid) land on its page here.
 */
export function InverterBrand({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const { data, isPending, inverters } = useInverters();
  const brand = useBrands().find((b) => b.slug === slug);
  const role = asRole(slug);

  // Old addresses: /integrations/inverters/hybrid (an inverter by its role) and /integrations/inverters/import.
  useEffect(() => {
    if (slug === "import")
      void navigate({ to: "/integrations/inverters/$brand/import", params: { brand: "sungrow" }, replace: true });
    if (!role || isPending) return;
    const device = inverters.find((i) => i.device.role === role)?.device;
    void navigate(
      device
        ? {
            to: "/integrations/inverters/$brand/$role",
            params: { brand: brandSlug(device.brand), role },
            replace: true,
          }
        : { to: "/integrations/inverters", replace: true },
    );
  }, [slug, role, isPending, inverters, navigate]);

  const back = <BackLink to="/integrations/inverters">Inverters</BackLink>;
  if (!brand)
    return (
      <SubPageHeader
        back={back}
        id="h-brand"
        title="Inverters"
        sub={
          isPending || role || slug === "import"
            ? "Checking what's connected…"
            : "WattsMyPower doesn't read that brand."
        }
      />
    );
  const about = BRAND_ABOUT[brand.name];
  return (
    <>
      <SubPageHeader back={back} id="h-brand" title={brand.name} sub={about?.about ?? ""} />
      <Summary brand={brand} />
      <SettingsSection
        id="h-brand-connected"
        title="Connected"
        sub={
          brand.inverters.length
            ? "Each one's page has what it reported about itself, how it's wired, and removing it."
            : `No ${brand.name} inverter is connected yet.`
        }
      >
        {brand.inverters.length > 0 && (
          <div className="overflow-hidden rounded-2xl bg-canvas/60 light:bg-canvas">
            {brand.inverters.map((i) => (
              <InverterRow key={i.device.role} inverter={i} />
            ))}
          </div>
        )}
        {data?.available && data.read_only && <ReadOnlyNote />}
      </SettingsSection>
      <SettingsSection
        id="h-brand-reads"
        title="What it reads"
        sub={
          brand.verified
            ? "Tried on real inverters."
            : `Untested: read from what ${brand.name} documents, not yet tried on a real one. If you have one, how it reads (or doesn't) gets it checked.`
        }
      >
        <div className="flex flex-col gap-3 rounded-2xl bg-canvas/60 p-5 light:bg-canvas">
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm text-ink-muted">
            {brand.kinds.map((k) => (
              <li key={k.driver}>
                <span className="font-medium text-ink">{k.label}</span> · as the {ROLE_NAME[k.role]} · e.g. {k.example}
              </li>
            ))}
          </ul>
          {about?.setup && <p className="m-0 text-[13px] leading-5 text-pretty text-ink-faint">{about.setup}</p>}
        </div>
      </SettingsSection>
      {brand.name === "Sungrow" && (
        <SettingsSection
          id="h-brand-history"
          title="History"
          sub="The days before WattsMyPower was set up, from Sungrow's own cloud."
        >
          <div className="overflow-hidden rounded-2xl bg-canvas/60 light:bg-canvas">
            <IntegrationLink
              to="/integrations/inverters/$brand/import"
              params={{ brand: "sungrow" }}
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
