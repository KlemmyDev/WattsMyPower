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
import { EvDetails } from "~/features/ev/components/EvDetails";
import { EvInOut } from "~/features/ev/components/EvInOut";
import { EvLevelChart } from "~/features/ev/components/EvLevelChart";
import { EvPanel } from "~/features/ev/components/EvPanel";
import type { EvVehicle, TeslaProvider } from "~/features/ev/types";
import { ProviderChip } from "~/features/ev/components/ProviderChip";
import { carTitle, evTitle } from "~/features/ev/utils";

/** One car, in full: big and simple at the top (its charge, what it's doing, how fresh that is), how it charges
 * beside what the dashboard did with it, its in and out, and everything else it says about itself. */
function Car({ v, provider, now }: { v: EvVehicle; provider: TeslaProvider | null; now: number }) {
  return (
    <div className="flex flex-col gap-5">
      <EvPanel v={v} provider={provider} />
      <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
        <EvCharging v={v} />
        <EvActivity now={now} vin={v.vin} />
      </div>
      <EvLevelChart vin={v.vin} now={now} />
      <EvInOut vin={v.vin} now={now} />
      <EvDetails vin={v.vin} name={v.name ?? "The car"} />
    </div>
  );
}

/**
 * The EV page: each car connected (so far Teslas, through Tessie or over Bluetooth), or with `vin`, one of them (its
 * own page, as the side nav lists them).
 */
export function EvPage({ vin }: { vin?: string } = {}) {
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
  const cars = vin ? data.vehicles.filter((v) => v.vin === vin) : data.vehicles;
  // One car shown: it's named for what it is (its own name is on its panel), with its model year.
  const one = cars.length === 1 ? cars[0] : null;
  const sub = (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      {one?.year && <span className="text-sm font-normal text-ink-muted tabular-nums">{one.year}</span>}
      {data.provider && <ProviderChip provider={data.provider} />}
      {data.read_at && <span className="text-sm font-normal text-ink-muted">Read {hhmm(data.read_at)}</span>}
    </span>
  );
  if (vin && cars.length === 0)
    return (
      <>
        <PageHeader title={evTitle(data.vehicles)} sub={sub} />
        <Notice tone="plain">That car isn't connected any more.</Notice>
      </>
    );
  return (
    <>
      <PageHeader title={one ? carTitle(one) : evTitle(cars)} sub={sub} />
      <div className="flex flex-col gap-10">
        {data.error && <Notice tone="bad">{data.error}</Notice>}
        {cars.map((v) => (
          <Car key={v.vin} v={v} provider={data.provider} now={now} />
        ))}
      </div>
    </>
  );
}
