import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { EmptyState } from "~/features/common/ui/components/EmptyState";
import { Notice } from "~/features/common/ui/components/Notice";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { bluelinkQuery, bydQuery, teslaQuery } from "~/features/ev/api";
import { BluelinkReads } from "~/features/ev/components/BluelinkReads";
import { BydHero } from "~/features/ev/components/BydHero";
import { Connection } from "~/features/ev/components/Connection";
import { EvCharging } from "~/features/ev/components/EvCharging";
import { EvDetails } from "~/features/ev/components/EvDetails";
import { EvHero } from "~/features/ev/components/EvHero";
import { EvInOut } from "~/features/ev/components/EvInOut";
import { useEvHero } from "~/features/ev/components/EvSky";
import { NextRead } from "~/features/ev/components/NextRead";
import type { BluelinkCar, EvVehicle, TeslaProvider } from "~/features/ev/types";
import { carTitle, evTitle } from "~/features/ev/utils";
import { useLiveDay, useLiveHero } from "~/features/live/hooks";

/** The columns under a car's hero, as Solar's, Home's and Battery's: the deeper story on the left, how it charges on
 * the right. On one column, how it charges comes first. */
function Columns({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div className="live-cols grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
      <div className="flex min-w-0 flex-col gap-5 max-3xl:order-2">{left}</div>
      <div className="flex min-w-0 flex-col gap-5 max-3xl:order-1">{right}</div>
    </div>
  );
}

/** One Tesla, in full: its charge limit, where it is and its day (its figures are in the top card), then its in and
 * out and everything else it says about itself beside how it charges. */
function TeslaCar({
  v,
  provider,
  alone,
  now,
}: {
  v: EvVehicle;
  provider: TeslaProvider | null;
  alone: boolean;
  now: number;
}) {
  return (
    <>
      <EvHero v={v} provider={provider} alone={alone} now={now} figures={false} />
      <Columns
        left={
          <>
            <EvInOut vin={v.vin} now={now} />
            <EvDetails vin={v.vin} name={v.name ?? "The car"} />
          </>
        }
        right={<EvCharging v={v} />}
      />
    </>
  );
}

/** A Hyundai or Kia, as a Tesla is shown (its hero, then how it charges from the sun), beside how it's read and what
 * the dashboard did with it lately. Its cloud keeps no day of it to chart, nor details beyond its charge. */
function BluelinkCarView({
  v,
  choices,
  alone,
  now,
}: {
  v: BluelinkCar;
  choices: number[];
  alone: boolean;
  now: number;
}) {
  return (
    <>
      <EvHero
        v={v}
        provider={v.make === "Kia" ? "kia" : "hyundai"}
        brand="bluelink"
        alone={alone}
        now={now}
        figures={false}
      />
      <Columns left={<BluelinkReads v={v} choices={choices} />} right={<EvCharging v={v} brand="bluelink" />} />
    </>
  );
}

/**
 * The EV page: each car connected (Teslas, through Tessie or over Bluetooth; Hyundais and Kias, through their cloud;
 * and BYDs, through BYD's cloud), or with `vin`, one of them (its own page, as the side nav lists them). The top card
 * the live pages share is about one car (useEvHero): the one shown, else the first Tesla, Hyundai or Kia. One car is
 * shown in full under it; several, each as a compact card that opens its own page. A BYD alone keeps its own card.
 */
export function EvPage({ vin }: { vin?: string } = {}) {
  const { now } = useLiveDay();
  const { data, error, isPending } = useQuery(teslaQuery);
  const { data: byd, isPending: bydPending } = useQuery(bydQuery);
  const { data: bluelink, isPending: bluelinkPending } = useQuery(bluelinkQuery);
  const shownTeslas = data?.connected ? data.vehicles.filter((v) => !vin || v.vin === vin) : [];
  const shownHks = bluelink?.connected ? bluelink.vehicles.filter((v) => !vin || v.vin === vin) : [];
  const focus: EvVehicle | null = shownTeslas[0] ?? (shownHks[0] as EvVehicle | undefined) ?? null;
  const connectedCars =
    (data?.connected ? data.vehicles.length : 0) +
    (bluelink?.connected ? bluelink.vehicles.length : 0) +
    (byd?.connected ? byd.vehicles.length : 0);
  const hero = useEvHero({ v: focus, brand: shownTeslas[0] ? "tesla" : "bluelink", alone: connectedCars === 1 });
  useLiveHero(hero);
  if (isPending || bydPending || bluelinkPending)
    return (
      <>
        <PageHeader title="EV" sub="Checking the connection…" />
        <Skeleton className="h-[420px] rounded-3xl" />
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
          Connect your Tesla over this server's Bluetooth or through Tessie. Its charge rate then follows the sun, so
          the car gets spare solar and your home battery still fills. A Hyundai or Kia can charge from spare solar too
          (started and stopped through its cloud). A BYD shows its charge.
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
  // Only one car connected at all: what the house saw go to cars today is all its own.
  const alone = allTeslas.length + allBluelink.length + allByds.length === 1;
  // One car shown: it's named for what it is (its own name is on its panel), with its model year.
  const one = cars.length === 1 ? cars[0] : null;
  // The Teslas' reach leads while any are shown, then a Hyundai or Kia's (a BYD panel says how fresh it is itself).
  const sub =
    data?.connected && (teslas.length || (!byds.length && !hks.length)) ? (
      <Connection status={data} provider={data.provider} year={one?.year ?? null} />
    ) : bluelink?.connected && (hks.length || !byds.length) ? (
      <Connection status={bluelink} provider={bluelink.brand === "kia" ? "kia" : "hyundai"} year={one?.year ?? null} />
    ) : byd?.connected ? (
      <Connection status={byd} provider="byd" year={one?.year ?? null} />
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
      {!hero && <PageHeader title={one ? carTitle(one) : evTitle(cars)} sub={sub} />}
      <div className="flex flex-col gap-5">
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
              A Tesla allows about three at once, and each phone or watch with its key uses one while it's nearby. Once
              one moves out of range, the dashboard can connect. It tries less often until then. If this keeps
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
        {one ? (
          teslas.length ? (
            <TeslaCar v={teslas[0]} provider={data?.provider ?? null} alone={alone} now={now} />
          ) : hks.length ? (
            <BluelinkCarView v={hks[0]} choices={bluelink?.force_choices ?? []} alone={alone} now={now} />
          ) : (
            <BydHero v={byds[0]} />
          )
        ) : cars.length === 0 ? (
          <EmptyState
            icon="car"
            id="h-te-none"
            title="No cars yet"
            action={
              <ButtonLink to="/integrations/ev" variant="outline" size="md">
                Your EV connections
              </ButtonLink>
            }
          >
            You're connected, but no car has shown up yet. It appears here once it's read.
          </EmptyState>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,560px),1fr))] gap-5">
            {teslas.map((v) => (
              <EvHero key={v.vin} v={v} provider={data?.provider ?? null} alone={false} now={now} compact />
            ))}
            {hks.map((v) => (
              <EvHero
                key={v.vin}
                v={v}
                provider={v.make === "Kia" ? "kia" : "hyundai"}
                brand="bluelink"
                alone={false}
                now={now}
                compact
              />
            ))}
            {byds.map((v) => (
              <BydHero key={v.vin} v={v} compact />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
