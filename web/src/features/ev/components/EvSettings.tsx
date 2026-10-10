import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "~/features/common/api/utils";
import { teslaQuery } from "~/features/ev/api";
import { teslaSummary } from "~/features/ev/utils";
import { IntegrationLink } from "~/features/integrations/components/IntegrationLink";
import { ReachTag } from "~/features/integrations/components/ReachTag";
import { SettingsSection } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

/**
 * Manage → Integrations → Electric vehicles: each EV brand WattsMyPower reaches (just Tesla for now), saying whether
 * it's connected and its cars, each opening to its own page: connecting it, its cars, and how they're reached.
 */
export function EvSettings() {
  const { data: status, isPending, error } = useQuery(teslaQuery);
  const tesla = teslaSummary(status);
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/integrations">Integrations</BackLink>}
        id="h-ev"
        title="Electric vehicles"
        sub="See each car's charge, and charge it from spare solar on the EV page."
      />
      {isPending && <p className="m-0 text-sm text-ink-muted">Checking what's connected…</p>}
      {error && <p className="m-0 text-sm text-bad">{errorMessage(error)}</p>}
      <SettingsSection id="h-ev-brands" title="Brands" sub="Each one says how it's reached. Open yours to connect it.">
        <div className="overflow-hidden rounded-2xl bg-canvas/60 light:bg-canvas">
          <IntegrationLink
            to="/integrations/ev/tesla"
            icon="car"
            name="Tesla"
            status={tesla.status || undefined}
            on={tesla.on}
            attention={tesla.connected && !tesla.on}
            detail={<span className="line-clamp-2">{tesla.detail}</span>}
            tags={tesla.reach.map((r) => (
              <ReachTag key={r} reach={r} />
            ))}
          />
        </div>
      </SettingsSection>
    </>
  );
}
