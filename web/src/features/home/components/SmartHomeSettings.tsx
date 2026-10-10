import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { COLOR } from "~/features/common/theme/utils/colors";
import { SummaryCard, SummaryStat } from "~/features/common/ui/components/Summary";
import { homeQuery } from "~/features/home/api";
import type { HomeIntegration } from "~/features/home/types";
import { integrationIcon, integrationReach, nowLine } from "~/features/home/utils";
import { IntegrationLink } from "~/features/integrations/components/IntegrationLink";
import { ReachTag } from "~/features/integrations/components/ReachTag";
import { SettingsSection } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A brand's account in a pill: signed out or not updating says so; connected once it's been read. */
export function accountPill(i: HomeIntegration): { status?: string; on: boolean; attention: boolean } {
  const a = i.account;
  if (!a) return { on: false, attention: false };
  if (a.signed_out) return { status: "Sign in again", on: false, attention: true };
  if (a.error) return { status: "Not updating", on: false, attention: true };
  if (!a.last_poll) return { status: "Connecting", on: false, attention: false };
  return { status: "Connected", on: true, attention: false };
}

/**
 * Manage → Integrations → Smart home: the devices across every brand at a glance, then each brand WattsMyPower reads
 * (connected first), each opening to its own page: its account, and its devices, each opening to theirs.
 */
export function SmartHomeSettings() {
  const { data, isPending, error } = useQuery(homeQuery);
  const integrations = data?.integrations ?? [];
  const connected = integrations.filter((i) => i.account);
  const attention = connected.filter((i) => accountPill(i).attention);
  const devices = data?.devices ?? [];
  const running = devices.filter((d) => nowLine(d).running).length;
  const local = connected.filter((i) => integrationReach(i) !== "cloud").length;
  const last = Math.max(0, ...connected.map((i) => i.account?.last_poll ?? 0));
  const order = [...connected, ...integrations.filter((i) => !i.account)];
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/integrations">Integrations</BackLink>}
        id="h-smart-home"
        title="Smart home"
        sub="Plugs, meters and appliances that say what they use, for the breakdown on the Home page. Connect as many brands as you have."
      />
      <SummaryCard
        icon="plug"
        color={attention.length ? COLOR.warn : COLOR.brand}
        label="Your smart home"
        footer={
          <div className="border-t border-line-subtle pt-4 text-[13px] text-ink-muted">
            {isPending
              ? "Checking what's connected…"
              : error
                ? errorMessage(error)
                : attention.length
                  ? `${attention.map((i) => i.name).join(", ")} ${attention.length === 1 ? "needs" : "need"} a look.`
                  : connected.length
                    ? `Everything connected is answering${last ? `, last read ${hhmm(last)}` : ""}.`
                    : "Nothing connected yet: choose a brand below."}
          </div>
        }
      >
        <SummaryStat
          label="Brands"
          value={connected.length}
          sub={`of ${integrations.length}`}
          color={attention.length ? COLOR.warn : undefined}
        />
        <SummaryStat
          label="Devices"
          value={devices.length}
          sub={`${devices.filter((d) => !d.hidden).length} in the breakdown`}
        />
        <SummaryStat label="Running now" value={running} sub={plural(running, "device")} />
        <SummaryStat
          label="On your network"
          value={`${local} of ${connected.length}`}
          sub={connected.length - local ? `${connected.length - local} through a cloud` : "No clouds"}
        />
      </SummaryCard>
      <SettingsSection
        id="h-smart-home-brands"
        title="Brands"
        sub="Each one says how it's reached: on your network, over Bluetooth, or through its maker's cloud (only where there's no other way)."
      >
        {integrations.length > 0 && (
          <div className="overflow-hidden rounded-2xl bg-canvas/60 light:bg-canvas">
            {order.map((i) => {
              const pill = accountPill(i);
              const a = i.account;
              return (
                <IntegrationLink
                  key={i.id}
                  to="/integrations/home/$integration"
                  params={{ integration: i.id }}
                  icon={integrationIcon(i)}
                  name={i.name}
                  status={pill.status}
                  on={pill.on}
                  attention={pill.attention}
                  detail={
                    <span className="line-clamp-2">
                      {a
                        ? [a.label, plural(a.devices, "device"), a.last_poll && `read ${hhmm(a.last_poll)}`]
                            .filter(Boolean)
                            .join(" · ")
                        : i.about}
                    </span>
                  }
                  tags={<ReachTag reach={integrationReach(i)} />}
                />
              );
            })}
          </div>
        )}
      </SettingsSection>
    </>
  );
}
