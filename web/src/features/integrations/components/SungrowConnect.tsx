import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { errorMessage } from "~/features/common/api/utils";
import { integrationsQuery } from "~/features/integrations/api";
import { ConnectInverter } from "~/features/integrations/components/ConnectInverter";
import { ReadOnlyNote } from "~/features/integrations/components/ConnectedInverters";
import { SettingsCard } from "~/features/settings/components/SettingsCard";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

/** Settings → Integrations → Sungrow → connecting an inverter, then on to its page. */
export function SungrowConnect() {
  const navigate = useNavigate();
  const { data, isPending, error } = useQuery(integrationsQuery);
  const hasHybrid = !!data?.devices.some((d) => d.role === "hybrid");

  return (
    <>
      <SubPageHeader
        back={<BackLink to="/settings/integrations/sungrow">Sungrow</BackLink>}
        id="h-connect"
        title={hasHybrid ? "Add an inverter" : "Connect your inverter"}
        sub={
          hasHybrid
            ? "A second solar inverter, or a new one to replace yours. Find it with a quick scan, or enter its address."
            : "Nothing is recorded until your main inverter (with the battery and meter) is connected. Find it with a quick scan, or enter its address."
        }
      />
      <SettingsCard aria-labelledby="h-connect">
        {isPending && <div className="px-6 py-5 text-sm text-ink-muted">Checking what's connected…</div>}
        {error && <div className="px-6 py-5 text-sm text-bad">{errorMessage(error)}</div>}
        {data && !data.available && <div className="px-6 py-5 text-sm leading-[22px] text-ink-muted">{data.error}</div>}
        {data?.available && data.read_only && <ReadOnlyNote />}
        {data?.available && !data.read_only && (
          <ConnectInverter
            overview={data}
            onConnected={(device) =>
              navigate({ to: "/settings/integrations/sungrow/$role", params: { role: device.role } })
            }
          />
        )}
      </SettingsCard>
    </>
  );
}
