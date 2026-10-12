import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { LocationPrompt } from "~/features/common/settings/components/LocationPrompt";
import { useLocationSet } from "~/features/common/settings/hooks";
import { useNow } from "~/features/common/time/hooks";
import { Card, Footnote } from "~/features/common/ui/components/Card";
import { Notice } from "~/features/common/ui/components/Notice";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { AccuracyCard } from "~/features/plan/components/AccuracyCard";
import { BestTimesCard } from "~/features/plan/components/BestTimes";
import { DayBreakdown } from "~/features/plan/components/DayBreakdown";
import { DaysAhead } from "~/features/plan/components/DaysAhead";
import { PlanHero } from "~/features/plan/components/PlanHero";
import { defaultDay, usePlan } from "~/features/plan/hooks";

/**
 * The Plan page, as Solar, Home and Battery lead with today: one card for the day open (today while there's solar to
 * come, else tomorrow, or the one in the address), with its solar, the next thing worth acting on, its figures and its
 * chart; then the days ahead side by side, and how the day's figures are worked out, on the left; what's worth knowing,
 * the best times to use power and how close the forecast has been on the right.
 */
export function PlanPage({ day: asked }: { day?: number }) {
  const now = useNow();
  const located = useLocationSet();
  const plan = usePlan(now);
  const { forecast, days, notes, accuracy, system } = plan;
  const navigate = useNavigate();
  const hero = useRef<HTMLElement>(null);
  const reveal = useRef(false);
  const selected = Math.min(asked ?? defaultDay(days), Math.max(0, days.length - 1));
  const day = days[selected];
  // The day is in the address, so the Overview can link straight to tomorrow's and Back returns to it.
  const select = (i: number, scroll = false) => {
    // Chosen from further down the page: bring the card it opens into view once it's drawn.
    reveal.current = scroll && (hero.current?.getBoundingClientRect().top ?? 0) < 0;
    navigate({ to: "/plan", search: { day: i }, replace: true, resetScroll: false });
  };
  useEffect(() => {
    if (!reveal.current) return;
    reveal.current = false;
    hero.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [day?.key]);

  const picker =
    days.length > 1 ? (
      <Segmented
        role="tablist"
        label="Day"
        value={String(selected)}
        onChange={(v) => select(Number(v))}
        options={days.map((d, i) => ({ value: String(i), label: d.label }))}
        buttonClassName="px-3.5 py-1.5 text-[13px]"
      />
    ) : undefined;

  return (
    <>
      <PageHeader
        title="Plan"
        sub="What the next few days should bring, and the best times to use power"
        action={located !== false ? picker : undefined}
      />
      {located === false ? (
        <LocationPrompt>
          The outlook comes from the weather where your panels are, so it needs your location.
        </LocationPrompt>
      ) : forecast === null ? (
        <Card>
          <div className="text-sm text-ink-faint">
            No forecast right now. Either the server can't reach Open-Meteo, or the forecast is turned off. Check the
            server's internet connection.
          </div>
        </Card>
      ) : !forecast || !day ? (
        // Shaped like the page to come: the card for the day, then the two columns.
        <div role="status" aria-label="Loading the forecast" className="flex flex-col gap-5">
          <Skeleton className="h-[640px] rounded-3xl" />
          <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
            <Skeleton className="h-[220px] rounded-3xl" />
            <Skeleton className="h-[320px] rounded-3xl" />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Keyed by day, so choosing another rises it into place afresh, chart drawing in. */}
          <PlanHero key={day.key} ref={hero} plan={plan} day={day} now={now} />
          <div className="grid grid-cols-[minmax(0,7fr)_minmax(0,5fr)] items-start gap-5 max-3xl:grid-cols-1">
            <div className="flex min-w-0 flex-col gap-5 max-3xl:contents">
              <DaysAhead
                days={days}
                selected={selected}
                onSelect={(i) => select(i, true)}
                system={system}
                now={now}
                className="max-3xl:order-2"
              />
              <DayBreakdown day={day} forecast={forecast} system={system} className="max-3xl:order-4" />
            </div>
            <div className="flex min-w-0 flex-col gap-5 max-3xl:contents">
              {notes.length > 0 && (
                <div className="flex flex-col gap-2 max-3xl:order-1">
                  {notes.map((n) => (
                    <Notice key={n.title} tone={n.tone} className="flex flex-col gap-0.5">
                      <span className="font-medium text-ink">{n.title}</span>
                      <span className="text-ink-muted">{n.sub}</span>
                    </Notice>
                  ))}
                </div>
              )}
              <BestTimesCard plan={plan} day={day} now={now} className="max-3xl:order-3" />
              <AccuracyCard accuracy={accuracy} className="max-3xl:order-5" />
            </div>
          </div>
          <Footnote>
            {forecast.calibration.fitted_hours >= 0.5
              ? `Solar forecast calibrated on ${forecast.calibration.fitted_hours} hours of your inverter's output.`
              : "The solar forecast isn't tuned to your system yet. It needs a few daylight hours of readings."}
            {forecast.model?.kind === "learned" &&
              ` It uses what it has learned from ${forecast.model.days} days of weather history.`}
          </Footnote>
        </div>
      )}
    </>
  );
}
