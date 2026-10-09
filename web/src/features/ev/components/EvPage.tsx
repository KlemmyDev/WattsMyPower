import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useNow } from "~/features/common/time/hooks";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { EmptyState } from "~/features/common/ui/components/EmptyState";
import { Notice } from "~/features/common/ui/components/Notice";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { teslaQuery } from "~/features/ev/api";
import { EvActivity } from "~/features/ev/components/EvActivity";
import { EvCharging } from "~/features/ev/components/EvCharging";
import { EvPanel } from "~/features/ev/components/EvPanel";
import { PROVIDER_VIA } from "~/features/ev/utils";

/**
 * Each EV connected (so far Teslas, through Tessie or over Bluetooth): big and simple at the top (its charge, what it's
 * doing, the spare solar it's following), how it charges beside what the dashboard did with it.
 */
export function EvPage() {
  const now = useNow(30_000);
  const { data, error, isPending } = useQuery(teslaQuery);
  if (isPending)
    return (
      <>
        <PageHeader title="EV" sub="Checking the connection…" />
        <Skeleton className="h-[260px] rounded-3xl" />
      </>
    );
  if (!data?.connected)
    return (
      <>
        <PageHeader title="EV" sub={error ? errorMessage(error) : "Not connected"} />
        <EmptyState
          icon="car"
          id="h-te"
          title="Charge your EV with spare solar"
          action={
            <ButtonLink to="/ev/setup" variant="primary" size="lg">
              Connect your EV
            </ButtonLink>
          }
        >
          Connect your Tesla, over this server's Bluetooth or through Tessie, and the charge rate follows the sun
          through the day, so the car gets spare solar and the home battery still fills.
        </EmptyState>
      </>
    );
  const one = data.vehicles.length === 1;
  return (
    <>
      <PageHeader
        title="EV"
        sub={[data.provider && PROVIDER_VIA[data.provider], data.read_at && `read ${hhmm(data.read_at)}`]
          .filter(Boolean)
          .join(" · ")}
      />
      <div className="flex flex-col gap-5">
        {data.error && <Notice tone="bad">{data.error}</Notice>}
        {data.vehicles.map((v) => (
          <div key={v.vin} className="flex flex-col gap-5">
            <EvPanel v={v} provider={data.provider} />
            <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
              <EvCharging v={v} />
              {one && <EvActivity now={now} />}
            </div>
          </div>
        ))}
        {!one && <EvActivity now={now} />}
      </div>
    </>
  );
}
