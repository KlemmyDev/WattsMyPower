import { hhmm } from "~/features/common/formatting/utils/date";
import { DASH, pct } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { HeroKey } from "~/features/common/ui/components/Hero";
import { CardText, SmallCard } from "~/features/common/ui/components/SmallCard";
import { useTween } from "~/features/common/ui/hooks/useTween";
import { EvChargeBar } from "~/features/ev/components/EvChargeBar";
import type { EvBrand, EvVehicle } from "~/features/ev/types";
import { carMood } from "~/features/ev/utils";

/**
 * The car's charge limit, as a small card: the limit as its figure (and about how far that takes you), its charge
 * along a bar with the limit as a handle you drag (asking first when that would wake the car), and while it charges,
 * where it's heading and by when.
 */
export function EvLimit({
  v,
  brand = "tesla",
  now,
  className,
}: {
  v: EvVehicle;
  brand?: EvBrand;
  now: number;
  className?: string;
}) {
  const s = v.state;
  const soc = useTween(s?.soc ?? undefined) ?? s?.soc ?? null;
  const mood = carMood({ status: v.status, mode: v.control.mode, asleep: s?.asleep, charging: s?.charging });
  const charging = mood.step === "charging";
  const limit = s?.limit != null ? Math.round(s.limit) : null;
  const fullAt = charging && s?.minutes_to_full ? now + s.minutes_to_full * 60 : null;
  // How far the limit takes it, from its range now.
  const reach = s?.range_km != null && s.soc && limit ? Math.round((s.range_km / s.soc) * limit) : null;
  return (
    <SmallCard
      id={`h-tlim-${v.vin}`}
      title="Charge limit"
      note={soc != null ? `${pct(soc)} now` : undefined}
      className={className}
    >
      <span className="flex items-baseline gap-1 tabular-nums">
        <span className="text-[28px] leading-8 font-light tracking-[-0.6px]">{limit ?? DASH}</span>
        {limit != null && <span className="text-sm text-ink-faint">%{reach != null ? `, about ${reach} km` : ""}</span>}
      </span>
      <EvChargeBar
        v={v}
        soc={soc}
        fill={charging ? mood.color : COLOR.battery}
        brand={brand}
        charging={charging}
        asleep={mood.step === "asleep"}
        expect={fullAt != null ? limit : null}
        legend={
          fullAt != null && limit != null ? (
            <HeroKey mark="dashed" color={mood.color}>
              At {pct(limit)} by {hhmm(fullAt)}
            </HeroKey>
          ) : undefined
        }
        className="mt-1"
      />
      <CardText>
        {limit == null
          ? "Its limit shows once the car's been read."
          : soc != null && soc >= limit - 1
            ? `It's at its limit, so it won't charge more until you raise it.`
            : `It stops charging at ${pct(limit)}${fullAt != null ? `, which it reaches by ${hhmm(fullAt)}` : ""}.`}
      </CardText>
    </SmallCard>
  );
}
