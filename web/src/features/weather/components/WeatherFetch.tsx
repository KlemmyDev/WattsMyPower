import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { intAU, plural } from "~/features/common/formatting/utils/number";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText } from "~/features/common/ui/components/Field";
import { Icon } from "~/features/common/ui/components/Icon";
import { ProgressBar, Spinner } from "~/features/common/ui/components/Progress";
import { cn } from "~/features/common/ui/utils";
import { startBackfill, weatherStatusQuery } from "~/features/weather/api";

/** Start filling in past weather (or, with `refetch`, fetching every day again), and follow its progress. */
export function useFetchWeather() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (refetch: boolean = false) => startBackfill(refetch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["weather"] }),
  });
}

/**
 * Filling in past weather: a bar while it's going, then how it went. `since` (unix seconds) shows the outcome
 * only of a fill that finished after then, so a page doesn't report one from long ago.
 */
export function WeatherFetchProgress({ since, className }: { since?: number; className?: string }) {
  const { data } = useQuery(weatherStatusQuery);
  const fetchWeather = useFetchWeather();
  const b = data?.backfill;
  if (!b) return null;
  const finished = !b.running && b.finished_at != null && (since == null || b.finished_at >= since);
  if (!b.running && !finished && !b.error) return null;
  const total = b.total ?? 0;

  if (b.running)
    return (
      <div className={cn("flex flex-col gap-2", className)} aria-live="polite">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Spinner />
          {b.total == null
            ? "Checking which days need their weather…"
            : `${b.refetch ? "Fetching the weather again" : "Fetching the weather"} for ${intAU(total)} ${plural(total, "day")}…`}
        </div>
        <ProgressBar value={b.total ? b.done / b.total : undefined} label="Fetching past weather" />
        <HelpText>
          {b.total
            ? `${intAU(b.done)} of ${intAU(total)} done. Open-Meteo sends up to three months at a time, so a year takes a few seconds.`
            : "From Open-Meteo, up to three months at a time."}
        </HelpText>
      </div>
    );

  if (b.error)
    return (
      <div className={cn("flex flex-wrap items-center gap-3", className)} aria-live="polite">
        <HelpText tone="bad" className="text-sm">
          {b.error}.
        </HelpText>
        <Button variant="link" size="sm" onClick={() => fetchWeather.mutate(false)} disabled={fetchWeather.isPending}>
          Try again
        </Button>
      </div>
    );

  return (
    <div className={cn("flex items-center gap-2 text-sm text-ink-muted", className)} aria-live="polite">
      <span className="text-good">
        <Icon name="check" size={16} />
      </span>
      {b.done
        ? `Weather fetched for ${intAU(b.done)} ${plural(b.done, "day")}. The forecast is learning from it now.`
        : "Every day with readings already has its weather."}
    </div>
  );
}
