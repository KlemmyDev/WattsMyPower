import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { homeQuery } from "~/features/home/api";
import type { HomeIntegration } from "~/features/home/types";
import { integrationIcon, integrationReach } from "~/features/home/utils";
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

/** A brand's row: its account at a glance once connected (what it is, its devices, when it was read), else what it
 * brings. */
function BrandRow({ i }: { i: HomeIntegration }) {
  const pill = accountPill(i);
  const a = i.account;
  return (
    <IntegrationLink
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
}

/**
 * Manage → Integrations → Smart home: the brands WattsMyPower reads, grouped by what they are (smart plugs,
 * appliances, portable batteries, home hubs), connected first in each, with any needing a look named at the top. Each
 * opens to its own page: its account, and its devices, each opening to theirs.
 */
export function SmartHomeSettings() {
  const { data, isPending, error } = useQuery(homeQuery);
  const integrations = data?.integrations ?? [];
  const attention = integrations.filter((i) => accountPill(i).attention);
  const groups = (data?.categories ?? [])
    .map((c) => {
      const brands = integrations.filter((i) => i.category === c.id);
      return { ...c, brands: [...brands.filter((i) => i.account), ...brands.filter((i) => !i.account)] };
    })
    .filter((c) => c.brands.length > 0);
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/integrations">Integrations</BackLink>}
        id="h-smart-home"
        title="Smart home"
        sub="Plugs, appliances and batteries that say what they use, for the breakdown on the Home page. Connect as many brands as you have: each says how it's reached."
      />
      {isPending && <p className="m-0 text-sm text-ink-muted">Checking what's connected…</p>}
      {error && <p className="m-0 text-sm text-bad">{errorMessage(error)}</p>}
      {attention.length > 0 && (
        <p className="m-0 text-sm text-warn">
          {attention.map((i) => i.name).join(", ")} {attention.length === 1 ? "needs" : "need"} a look.
        </p>
      )}
      {groups.map((c) => (
        <SettingsSection key={c.id} id={`h-smart-home-${c.id}`} title={c.label} sub={c.about}>
          <div className="overflow-hidden rounded-2xl bg-canvas/60 light:bg-canvas">
            {c.brands.map((i) => (
              <BrandRow key={i.id} i={i} />
            ))}
          </div>
        </SettingsSection>
      ))}
    </>
  );
}
