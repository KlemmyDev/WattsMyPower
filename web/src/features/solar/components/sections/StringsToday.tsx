import { hhmm } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, pct } from "~/features/common/formatting/utils/number";
import type { Snapshot } from "~/features/common/live/types";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Delta, Meter } from "~/features/common/ui/components/Live";
import { parts, Quiet } from "~/features/common/widgets/parts";
import { LineDot } from "~/features/solar/components/sections/StringsChart";
import { stringsOf } from "~/features/solar/utils";
import { energyOf, peakOf, type StringDay } from "~/features/solar/utils/sections";

/** Strings this far apart in the sun are worth a look (as on the Strings widget). */
const APART = 0.2;

/**
 * How each string is doing today: what it's made (its power added up, so close to but not exactly the inverter's own
 * count), its peak, its volts and amps now, and how far apart the two are now. Strings of different sizes or facings
 * always differ, so the gap is shown, not judged, until it's wide in full sun.
 */
export function StringsToday({ t, strings, p }: { t: number[]; strings: StringDay[]; p: Snapshot | null }) {
  const live = stringsOf(p);
  const rows = strings.map((s) => {
    const now = live.list.find((x) => x.n === s.n);
    return { s, kwh: energyOf(t, s.w), peak: peakOf(t, s.w), v: now?.v ?? null, a: now?.a ?? null };
  });
  const top = Math.max(0.001, ...rows.map((r) => r.kwh ?? 0));
  const [one, two] = rows;
  const gap = one?.kwh && two?.kwh ? 1 - Math.min(one.kwh, two.kwh) / Math.max(one.kwh, two.kwh) : null;
  const behind = gap != null ? (one.kwh! < two.kwh! ? one : two) : null;
  const ahead = behind === one ? two : one;
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <TitleBlock
          className="min-w-0 flex-1"
          title="How each string is doing"
          sub={
            strings.length < 2
              ? "Today so far"
              : gap != null && behind && gap >= 0.02
                ? `String ${behind.s.n} has made ${pct(gap * 100)} less than string ${ahead.s.n} today`
                : "Both strings level today"
          }
        />
        {live.apart != null && (
          <Delta value={live.apart > APART ? -live.apart : 0}>
            {live.apart > APART ? `${pct(live.apart * 100)} apart now` : "Even now"}
          </Delta>
        )}
      </div>
      {strings.length === 0 ? (
        <Quiet>Your inverter doesn't report its strings, so there's nothing to compare here.</Quiet>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-5 p-0">
          {rows.map((r) => (
            <li key={r.s.n} className="flex flex-col gap-2">
              <div className="flex items-baseline gap-3">
                <span className="flex min-w-0 flex-1 items-center gap-2 text-[14.5px]">
                  <LineDot color={r.s.color} />
                  String {r.s.n}
                </span>
                <span className="flex items-baseline gap-1 font-light tabular-nums">
                  <span className="text-[20px] leading-7">{parts(kWh(r.kwh))[0]}</span>
                  <span className="text-[13px] font-normal text-ink-faint">{parts(kWh(r.kwh))[1]}</span>
                </span>
              </div>
              <Meter share={(r.kwh ?? 0) / top} color={r.s.color} />
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-faint tabular-nums">
                <span>{r.peak ? `Peak ${kW(r.peak.v)} at ${hhmm(r.peak.t)}` : "No peak yet"}</span>
                <span>
                  Now {r.v != null ? `${Math.round(r.v)} V` : DASH} · {r.a != null ? `${r.a.toFixed(1)} A` : DASH}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {strings.length === 1 && (
        <Quiet>Only one string is connected, so there's no second one to measure it against.</Quiet>
      )}
      {strings.length === 2 && (
        <div className="text-xs text-pretty text-ink-faint">
          Strings with different panel counts or facings always differ. One falling well behind the other in full sun
          can mean shade, dirt or a fault.
        </div>
      )}
    </Card>
  );
}
