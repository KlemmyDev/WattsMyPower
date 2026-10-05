import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { amberQuery } from "~/features/amber/api";
import { tariffQuery } from "~/features/common/tariffs/api";
import { Button } from "~/features/common/ui/components/Button";
import { Icon } from "~/features/common/ui/components/Icon";
import { SettingsCard } from "~/features/settings/components/SettingsCard";

const amberLink = (text: ReactNode) => (
  <Link to="/settings/integrations/amber" className="text-link hover:text-link-hover">
    {text}
  </Link>
);

/**
 * Settings → Bills: a line about Amber Electric. Connected, it switches the rates to Amber's prices;
 * not, it says where to connect it.
 */
export function AmberTariffRow({ onUse }: { onUse: () => void }) {
  const { data: status } = useQuery(amberQuery);
  const tariff = useQuery(tariffQuery).data;
  if (!status) return null;

  let line: ReactNode;
  let action: ReactNode = null;
  if (!status.connected) {
    line = <>On Amber Electric? {amberLink("Connect it in Integrations")} to cost your power at its prices.</>;
  } else if (!status.site_id) {
    line = <>Amber Electric is connected. {amberLink("Choose your site")} to use its prices.</>;
  } else if (tariff?.type === "amber") {
    line = <>Your rates use Amber Electric's prices. {amberLink("Amber settings")}</>;
  } else {
    line = <>Amber Electric is connected, but your rates don't use its prices yet.</>;
    action = (
      <Button size="sm" variant="outline" onClick={onUse}>
        Use Amber prices
      </Button>
    );
  }

  return (
    <SettingsCard aria-label="Amber Electric" className="flex-row flex-wrap items-center gap-x-4 gap-y-3 px-6 py-4">
      <div className="flex min-w-[200px] flex-1 items-center gap-3">
        <span className="flex size-9 flex-none items-center justify-center rounded-full bg-canvas text-ink">
          <Icon name="dollar" size={18} />
        </span>
        <span className="text-sm text-ink-muted">{line}</span>
      </div>
      {action}
    </SettingsCard>
  );
}
