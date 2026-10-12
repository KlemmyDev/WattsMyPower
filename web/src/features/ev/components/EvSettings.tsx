import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "~/features/common/api/utils";
import { COLOR } from "~/features/common/theme/utils/colors";
import { bluelinkQuery, bydQuery, teslaQuery } from "~/features/ev/api";
import { bluelinkSummary, bydSummary, teslaSummary } from "~/features/ev/utils";
import { IntegrationLink } from "~/features/integrations/components/IntegrationLink";
import { ReachTag, UntestedTag } from "~/features/integrations/components/ReachTag";
import { SettingsSection } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";
import { PageProblem } from "~/features/settings/components/PageStatus";

/**
 * Manage → Integrations → Electric vehicles: each EV brand WattsMyPower reaches (Tesla, Hyundai and Kia, and BYD),
 * saying whether it's
 * connected and its cars, each opening to its own page: connecting it, its cars, and how they're reached.
 */
export function EvSettings() {
  const { data: status, error } = useQuery(teslaQuery);
  const { data: bydStatus } = useQuery(bydQuery);
  const { data: bluelinkStatus } = useQuery(bluelinkQuery);
  const tesla = teslaSummary(status);
  const byd = bydSummary(bydStatus);
  const hk = bluelinkSummary(bluelinkStatus);
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/integrations">Integrations</BackLink>}
        title="Electric vehicles"
        sub="See each car's charge on the EV page, and charge a Tesla, Hyundai or Kia from spare solar."
      />
      {error && <PageProblem>{errorMessage(error)}</PageProblem>}
      <SettingsSection id="h-ev-brands" title="Brands" sub="Each one says how it's reached. Open yours to connect it.">
        <div className="overflow-hidden rounded-2xl bg-canvas/60 light:bg-canvas">
          <IntegrationLink
            to="/integrations/ev/tesla"
            icon="car"
            color={COLOR.danger}
            name="Tesla"
            status={tesla.status || undefined}
            on={tesla.on}
            attention={tesla.connected && !tesla.on}
            detail={<span className="line-clamp-2">{tesla.detail}</span>}
            tags={tesla.reach.map((r) => (
              <ReachTag key={r} reach={r} />
            ))}
          />
          <IntegrationLink
            to="/integrations/ev/hyundai-kia"
            icon="car"
            color={COLOR.danger}
            name="Hyundai and Kia"
            status={hk.status || undefined}
            on={hk.on}
            attention={hk.connected && !hk.on}
            detail={<span className="line-clamp-2">{hk.detail}</span>}
            tags={
              <>
                <ReachTag reach="cloud" />
                <UntestedTag />
              </>
            }
          />
          <IntegrationLink
            to="/integrations/ev/byd"
            icon="car"
            color={COLOR.danger}
            name="BYD"
            status={byd.status || undefined}
            on={byd.on}
            attention={byd.connected && !byd.on}
            detail={<span className="line-clamp-2">{byd.detail}</span>}
            tags={
              <>
                <ReachTag reach="cloud" />
                <UntestedTag />
              </>
            }
          />
        </div>
      </SettingsSection>
    </>
  );
}
