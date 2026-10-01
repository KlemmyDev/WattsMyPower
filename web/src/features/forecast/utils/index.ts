import { hhmm } from "~/features/common/formatting/utils/date";
import { kWh, pct } from "~/features/common/formatting/utils/number";
import type { Snapshot } from "~/features/common/live/types";
import { sameDay } from "~/features/common/time/utils";
import type { Forecast } from "~/features/common/weather/types";

/** Headline forecast figures for the Forecast page cards. */
export function forecastSummary(f: Forecast, p: Snapshot | null | undefined, now: number): [string, string][] {
  const fa = f.summary.full_at;
  const full =
    p && (p.battery_soc ?? 0) >= 99.5
      ? "Full now"
      : fa && fa < now + 86400
        ? sameDay(fa, now)
          ? hhmm(fa)
          : `Tomorrow ${hhmm(fa)}`
        : "Not today";
  return [
    ["Forecast solar", kWh(f.summary.pv_kwh_24h)],
    ["Battery full at", full],
    ["Lowest battery overnight", pct(f.summary.min_soc_tonight)],
    ["Tomorrow morning", f.summary.tomorrow_morning],
  ];
}
