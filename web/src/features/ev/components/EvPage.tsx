import { useQuery } from "@tanstack/react-query";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useNow } from "~/features/common/time/hooks";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { EmptyState } from "~/features/common/ui/components/EmptyState";
import { Notice } from "~/features/common/ui/components/Notice";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { bluelinkQuery, bydQuery, teslaQuery } from "~/features/ev/api";
import { BluelinkReads } from "~/features/ev/components/BluelinkReads";
import { BydPanel } from "~/features/ev/components/BydPanel";
import { EvCharging } from "~/features/ev/components/EvCharging";
import { EvDetails } from "~/features/ev/components/EvDetails";
import { EvInOut } from "~/features/ev/components/EvInOut";
import { EvDayChart } from "~/features/ev/components/EvDayChart";
import { EvPanel } from "~/features/ev/components/EvPanel";
import { NextRead } from "~/features/ev/components/NextRead";
import type { BluelinkCar, EvVehicle, TeslaProvider, TeslaStatus } from "~/features/ev/types";
import { ProviderChip, type Reached } from "~/features/ev/components/ProviderChip";
import { carTitle, evTitle } from "~/features/ev/utils";

/** One car, in full: big and simple at the top (its charge, what it's doing, how fresh that is), its day (its charge,
 * what went into it and from where, and everything the dashboard did with it, day by day), how it charges beside its
 * in and out (stacked on a narrower screen), and everything else it says about itself. */
function Car({ v, provider, now }: { v: EvVehicle; provider: TeslaProvider | null; now: number }) {
  return (
    <div className="flex flex-col gap-5">
      <EvPanel v={v} provider={provider} />
      <EvDayChart v={v} now={now} />
      <div className="grid grid-cols-2 items-start gap-5 max-lg:grid-cols-1">
        <EvCharging v={v} className="min-w-0" />
        <EvInOut vin={v.vin} now={now} className="min-w-0" />
      </div>
      <EvDetails vin={v.vin} name={v.name ?? "The car"} />
    </div>
  );
}

/** A Hyundai or Kia, as a Tesla is shown (its charge, then how it charges from the sun), beside how it's read and
 * what the dashboard did with it lately. Its cloud keeps no day of it to chart, nor details beyond its charge. */
function BluelinkCarView({ v, choices }: { v: BluelinkCar; choices: number[] }) {
  const reached = v.make === "Kia" ? "kia" : "hyundai";
  return (
    <div className="flex flex-col gap-5">
      <EvPanel v={v} provider={reached} brand="bluelink" />
      <div className="grid grid-cols-2 items-start gap-5 max-lg:grid-cols-1">
        <EvCharging v={v} brand="bluelink" className="min-w-0" />
        <BluelinkReads v={v} choices={choices} className="min-w-0" />
      </div>
    </div>
  );
}

/** How the cars shown are reached, for under the page's title: the Teslas' way (Bluetooth or Tessie), else BYD's
 * cloud; when they were read, and when they're next read. */
function Reach({ status, provider, year }: { status: Freshness; provider: Reached | null; year: number | null }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      {year && <span className="text-sm font-normal text-ink-muted tabular-nums">{year}</span>}
      {provider && <ProviderChip provider={provider} />}
      {status.read_at && <span className="text-sm font-normal text-ink-muted">Read {hhmm(status.read_at)}</span>}
      {!status.error && <NextRead status={status} />}
    </span>
  );
}

type Freshness = Pick<TeslaStatus, "read_at" | "next_read" | "reading" | "error">;

/**
 * The EV page: each car connected (Teslas, through Tessie or over Bluetooth; Hyundais and Kias, through their cloud;
 * and BYDs, through BYD's cloud), or with
 * `vin`, one of them (its own page, as the side nav lists them).
 */
export function EvPage({ vin }: { vin?: string } = {}) {
  const now = useNow(30_000);
  const { data, error, isPending } = useQuery(teslaQuery);
  const { data: byd, isPending: bydPending } = useQuery(bydQuery);
  const { data: bluelink, isPending: bluelinkPending } = useQuery(bluelinkQuery);
  if (isPending || bydPending || bluelinkPending)
    return (
      <>
        <PageHeader title="EV" sub="Checking the connection…" />
        <Skeleton className="h-[260px] rounded-3xl" />
      </>
    );
  if (!data?.connected && !byd?.connected && !bluelink?.connected)
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
          through the day, so the car gets spare solar and the home battery still fills. A Hyundai or Kia can be charged
          from spare solar too (started and stopped through its cloud), and a BYD connected to see its charge.
        </EmptyState>
      </>
    );
  const allTeslas = data?.connected ? data.vehicles : [];
  const allByds = byd?.connected ? byd.vehicles : [];
  const allBluelink = bluelink?.connected ? bluelink.vehicles : [];
  const teslas = vin ? allTeslas.filter((v) => v.vin === vin) : allTeslas;
  const byds = vin ? allByds.filter((v) => v.vin === vin) : allByds;
  const hks = vin ? allBluelink.filter((v) => v.vin === vin) : allBluelink;
  const cars = [...teslas, ...hks, ...byds];
  // One car shown: it's named for what it is (its own name is on its panel), with its model year.
  const one = cars.length === 1 ? cars[0] : null;
  // The Teslas' reach leads while any are shown, then a Hyundai or Kia's (a BYD panel says how fresh it is itself).
  const sub =
    data?.connected && (teslas.length || (!byds.length && !hks.length)) ? (
      <Reach status={data} provider={data.provider} year={one?.year ?? null} />
    ) : bluelink?.connected && (hks.length || !byds.length) ? (
      <Reach status={bluelink} provider={bluelink.brand === "kia" ? "kia" : "hyundai"} year={one?.year ?? null} />
    ) : byd?.connected ? (
      <Reach status={byd} provider="byd" year={one?.year ?? null} />
    ) : null;
  if (vin && cars.length === 0)
    return (
      <>
        <PageHeader title={evTitle([...allTeslas, ...allBluelink, ...allByds])} sub={sub} />
        <Notice tone="plain">That car isn't connected any more.</Notice>
      </>
    );
  return (
    <>
      <PageHeader title={one ? carTitle(one) : evTitle(cars)} sub={sub} />
      <div className="flex flex-col gap-10">
        {bluelink?.error && hks.length > 0 && (
          <Notice tone="bad" className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span>
              {bluelink.brand === "kia" ? "Kia Connect" : "Bluelink"}: {bluelink.error}
            </span>
            <NextRead status={bluelink} className="text-inherit" />
          </Notice>
        )}
        {byd?.error && byds.length > 0 && (
          <Notice tone="bad" className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span>BYD: {byd.error}</span>
            <NextRead status={byd} className="text-inherit" />
          </Notice>
        )}
        {!data?.connected || !teslas.length ? null : data.error && data.error_kind === "busy" ? (
          <Notice tone="warn" className="flex flex-col gap-1.5 px-5 py-4">
            <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <b className="font-semibold">Your car isn't taking Bluetooth connections right now</b>
              <NextRead status={data} className="text-inherit" />
            </span>
            <span className="text-pretty text-ink-muted">
              A Tesla takes about three at once, and each phone or watch with its key holds one while it's near the car.
              The dashboard gets in once one of them is out of range; it eases off trying in the meantime. If this keeps
              happening, remove a key you don't use (in the car, under Controls → Locks).
            </span>
          </Notice>
        ) : (
          data.error && (
            <Notice tone="bad" className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span>{data.error}</span>
              <NextRead status={data} className="text-inherit" />
            </Notice>
          )
        )}
        {teslas.map((v) => (
          <Car key={v.vin} v={v} provider={data?.provider ?? null} now={now} />
        ))}
        {hks.map((v) => (
          <BluelinkCarView key={v.vin} v={v} choices={bluelink?.force_choices ?? []} />
        ))}
        {byds.map((v) => (
          <BydPanel key={v.vin} v={v} />
        ))}
      </div>
    </>
  );
}
