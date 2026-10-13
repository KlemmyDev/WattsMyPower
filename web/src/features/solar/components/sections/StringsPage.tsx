import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { kW, plural } from "~/features/common/formatting/utils/number";
import { ON } from "~/features/common/energy/utils";
import { useSnapshot } from "~/features/common/live/hooks/useSnapshot";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import type { SystemInfo } from "~/features/common/live/types";
import { historyQuery } from "~/features/common/readings/api";
import { useNow } from "~/features/common/time/hooks";
import { addDays, midnight } from "~/features/common/time/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Icon } from "~/features/common/ui/components/Icon";
import { Skeleton } from "~/features/common/ui/components/Skeleton";
import { cn } from "~/features/common/ui/utils";
import { solarInsightsQuery } from "~/features/solar/api";
import { SolarSection } from "~/features/solar/components/sections/SolarSection";
import { StringsDay } from "~/features/solar/components/sections/StringsDay";
import { StringsHeld } from "~/features/solar/components/sections/StringsHeld";
import { InverterCard } from "~/features/solar/components/sections/StringsInverters";
import { StringsToday } from "~/features/solar/components/sections/StringsToday";
import { place, stringsOf } from "~/features/solar/utils";
import { daylightWindow, inverterDays, stringDays } from "~/features/solar/utils/sections";

const STRING_FIELDS = ["mppt1_v", "mppt1_a", "mppt2_v", "mppt2_a"];
const FIELDS = ["pv_power", "pv1_power", "pv2_power", "inverter_temp", "pv2_temp", ...STRING_FIELDS];

/**
 * Solar › Strings and inverters: a card per inverter (now against its limit, today, peak, heat, and whether it sat at
 * its limit), each string through the day in power, volts or amps (against yesterday's, when asked), how the strings
 * compare today, and how often output's been held at the limit lately.
 */
export function SolarStringsPage() {
  const now = useNow(30_000);
  const p = useSnapshot();
  const s = useSystem();
  const [compare, setCompare] = useState(false);
  const start = midnight(now);
  const today = useQuery(historyQuery({ start, end: addDays(start, 1), points: 288, fields: FIELDS, live: true }));
  const before = useQuery({
    ...historyQuery({ start: addDays(start, -1), end: start, points: 288, fields: STRING_FIELDS }),
    enabled: compare,
  });
  const { data: insights } = useQuery(solarInsightsQuery);
  const capped = insights?.performance?.causes?.capped ?? null;

  const series = today.data?.series;
  const t = series?.t ?? [];
  const strings = stringDays(series);
  const inverters = inverterDays(p, s, series, capped?.limit_kw ?? null);
  const { from, to } = daylightWindow(start, place(s));
  const yesterday =
    compare && before.data ? { t: before.data.series.t, strings: stringDays(before.data.series) } : null;

  return (
    <SolarSection
      section="strings"
      sub={subLine(s, Math.max(strings.length, stringsOf(p).list.length), p?.pv_power ?? null)}
      action={
        strings.length > 0 && (
          <Button
            variant="chip"
            aria-pressed={compare}
            onClick={() => setCompare(!compare)}
            className={cn("gap-1.5", compare && "border-ink text-ink")}
          >
            <Icon name={compare ? "check" : "plus"} size={14} />
            Compare with yesterday
          </Button>
        )
      }
    >
      <div className={cn("grid gap-5", inverters.length > 1 && "grid-cols-2 max-xl:grid-cols-1")}>
        {inverters.map((inv) => (
          <InverterCard key={inv.key} inv={inv} loading={!series} />
        ))}
      </div>
      {!series ? (
        <Skeleton className="h-[380px] rounded-3xl" />
      ) : (
        strings.length > 0 && <StringsDay t={t} strings={strings} yesterday={yesterday} from={from} to={to} now={now} />
      )}
      {series && (
        <div
          className={cn(
            "grid items-start gap-5",
            capped && "grid-cols-[minmax(0,7fr)_minmax(0,5fr)] max-3xl:grid-cols-1",
          )}
        >
          <StringsToday t={t} strings={strings} p={p} />
          {capped && <StringsHeld capped={capped} t={t} pv={series.pv_power} from={from} to={to} />}
        </div>
      )}
    </SolarSection>
  );
}

/** "2 strings on the SH5.0RS · 4.2 kW now", or how many inverters there are when the strings aren't known. */
function subLine(s: SystemInfo | undefined, strings: number, pv: number | null) {
  const where = s?.pv2 ? "the hybrid" : s?.model ? `the ${s.model}` : "your inverter";
  const first = strings
    ? `${strings} ${plural(strings, "string")} on ${where}${s?.pv2 ? ", and a second inverter" : ""}`
    : s?.pv2
      ? "Two inverters"
      : "Your inverter";
  const second = pv == null ? null : pv > ON ? `${kW(pv)} now` : "panels resting";
  return [first, second].filter(Boolean).join(" · ");
}
