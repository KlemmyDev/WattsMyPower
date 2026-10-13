import { duration, hhmm } from "~/features/common/formatting/utils/date";
import { DASH, kW, kWh, pct } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Card } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { Figure, Meter } from "~/features/common/ui/components/Live";
import { parts } from "~/features/common/widgets/parts";
import { SOLAR } from "~/features/solar/components/parts";
import type { InverterDay } from "~/features/solar/utils/sections";

/** How each inverter's measured against, in the line under its meter. */
const AGAINST = { limit: "limit", rating: "rating", array: "array" } as const;

/**
 * An inverter's day in a card: what it's making now against its limit (or rating, or the array) as a meter, today's
 * total and peak, how hot it is and has been, and whether it sat at its limit today. One card per inverter.
 */
export function InverterCard({ inv, loading }: { inv: InverterDay; loading: boolean }) {
  const [value, unit] = parts(kW(inv.now));
  const share = inv.now != null && inv.limit ? inv.now / inv.limit.w : null;
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-xl"
            style={{ background: alpha(SOLAR, 0.14), color: SOLAR }}
          >
            <Icon name="bolt" size={18} />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="truncate">{inv.name}</h2>
            <div className="text-[13px] leading-5 text-ink-muted">{inv.kind}</div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="text-xs text-ink-muted">Now</span>
          <Figure value={value} unit={unit} />
        </div>
      </div>
      {inv.limit && (
        <div className="flex flex-col gap-2">
          <Meter share={share ?? 0} color={SOLAR} />
          <div className="text-xs text-ink-faint tabular-nums">
            {share != null ? `${pct(share * 100)} of its ` : "Its "}
            {kW(inv.limit.w)} {AGAINST[inv.limit.what]}
          </div>
        </div>
      )}
      <dl className="grid grid-cols-4 gap-x-4 gap-y-4 max-md:grid-cols-2">
        <Stat label="Today" value={kWh(inv.today)} />
        <Stat
          label="Peak"
          value={inv.peak ? kW(inv.peak.v) : DASH}
          sub={inv.peak ? `at ${hhmm(inv.peak.t)}` : undefined}
        />
        <Stat label="Temperature" value={inv.temp != null ? `${Math.round(inv.temp)} °C` : DASH} sub="Now" />
        <Stat
          label="Hottest"
          value={inv.hottest ? `${Math.round(inv.hottest.v)} °C` : DASH}
          sub={inv.hottest ? `at ${hhmm(inv.hottest.t)}` : loading ? undefined : "No readings today"}
        />
      </dl>
      {!loading && <Status inv={inv} />}
    </Card>
  );
}

/** A figure with its label above and a faint line under, as in the hero's stats. */
function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const [v, u] = parts(value);
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="m-0 flex items-baseline gap-1 font-light tabular-nums">
        <span className="text-[20px] leading-7">{v}</span>
        {u && <span className="text-[13px] font-normal text-ink-faint">{u}</span>}
      </dd>
      {sub && <dd className="m-0 text-xs text-ink-faint tabular-nums">{sub}</dd>}
    </div>
  );
}

/**
 * Whether the inverter sat at its limit today: when, if once; for how long all told, if on and off. Said only against a
 * real limit or rating (not the array, which output can't be held at), and only once it's made something.
 */
function Status({ inv }: { inv: InverterDay }) {
  if (!inv.limit || inv.limit.what === "array") return null;
  const held = inv.held;
  let text: string;
  let warn = false;
  if (held.length) {
    warn = true;
    const at = kW(inv.limit.w);
    const first = held[0];
    const last = held[held.length - 1];
    text =
      held.length === 1
        ? `Held at ${at} from ${hhmm(first.from)} to ${hhmm(first.to)}`
        : `Held at ${at} for ${duration(held.reduce((n, h) => n + h.to - h.from, 0))}, on and off from ${hhmm(first.from)} to ${hhmm(last.to)}`;
  } else if (inv.peak && inv.peak.v > 50) {
    text = "Stayed under its limit today";
  } else return null;
  return (
    <div className="flex items-center gap-2 border-t border-line-subtle pt-4 text-[13px] text-ink-muted">
      <Icon name={warn ? "pause" : "check"} size={15} style={{ color: warn ? COLOR.warn : COLOR.good }} />
      {text}
    </div>
  );
}
