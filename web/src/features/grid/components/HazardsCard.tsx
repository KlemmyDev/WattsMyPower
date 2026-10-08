import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import type { FireWarning, HazardsView, WeatherWarning } from "~/features/grid/types";

/** QFD's warning levels in the Australian Warning System's colours: advice yellow, watch and act orange, emergency red. */
const FIRE_COLOR: Record<FireWarning["level"], string> = {
  Information: alpha(COLOR.fg, 0.35),
  Advice: COLOR.solar,
  "Watch and Act": COLOR.warn,
  "Emergency Warning": COLOR.danger,
};

const when = (ts: number, now: number) =>
  new Date(ts * 1000).toDateString() === new Date(now * 1000).toDateString()
    ? hhmm(ts)
    : `${shortDay.format(new Date(ts * 1000))} ${hhmm(ts)}`;

function WeatherRow({ w, now }: { w: WeatherWarning; now: number }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-line-subtle py-2.5 last:border-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-start gap-2.5 text-left"
      >
        <span
          className="mt-0.5 flex size-6 flex-none items-center justify-center rounded-lg"
          style={{
            background: alpha(w.level === "warning" ? COLOR.warn : COLOR.solar, 0.16),
            color: w.level === "warning" ? COLOR.warn : COLOR.solar,
          }}
        >
          <Icon name={/flood|rain/i.test(w.event) ? "rain" : /fire/i.test(w.event) ? "flame" : "storm"} size={14} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[13.5px] leading-5 text-ink">{w.headline || w.event}</span>
          <span className="text-xs text-ink-faint">
            Bureau of Meteorology
            {w.expires ? ` · until ${when(w.expires, now)}` : ""}
            {w.here ? " · drawn over your area" : ""}
          </span>
        </span>
        <Icon
          name="chevD"
          size={14}
          className={cn("mt-1 flex-none text-ink-faint transition-transform", open && "rotate-180")}
        />
      </button>
      {open && w.description && (
        <p className="m-0 pt-2 pl-[34px] text-[12.5px] leading-[18px] whitespace-pre-wrap text-ink-muted">
          {w.description}
        </p>
      )}
    </li>
  );
}

function FireRow({ f }: { f: FireWarning }) {
  return (
    <li className="flex items-start gap-2.5 border-b border-line-subtle py-2.5 last:border-0">
      <span
        className="mt-0.5 flex size-6 flex-none items-center justify-center rounded-lg"
        style={{ background: alpha(FIRE_COLOR[f.level], 0.18), color: FIRE_COLOR[f.level] }}
      >
        <Icon name="flame" size={14} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[13.5px] leading-5 text-ink">
          {f.level === "Information" ? "Fire" : f.level}: {f.area || "Area not given"}
        </span>
        <span className="text-xs text-ink-faint">
          Queensland Fire Department{f.action && f.level !== "Information" ? ` · ${f.action}` : ""}
          {f.status ? ` · ${f.status}` : ""}
        </span>
      </span>
      <span className="flex-none text-xs text-ink-faint tabular-nums">
        {f.here ? "Your area" : `${f.distance_km} km ${f.direction ?? ""}`}
      </span>
    </li>
  );
}

/**
 * The Bureau of Meteorology's warnings for the house's districts and the Fire Department's fires around it: the early
 * signs the power may go. Shown whether or not there are any.
 */
export function HazardsCard({ view, now }: { view: HazardsView; now: number }) {
  const count = view.weather.length + view.fires.filter((f) => f.level !== "Information").length;
  const sub = !view.enabled
    ? "Turned off"
    : count
      ? `${count} ${count === 1 ? "warning" : "warnings"} for your area`
      : view.fetched_at
        ? `No weather${view.fires_followed ? " or fire" : ""} warnings for your area`
        : "Weather and fire warnings for your area will show here";
  return (
    <Card>
      <TitleBlock title="Warnings" sub={sub} />
      {view.enabled ? (
        view.weather.length || view.fires.length ? (
          <ul className="-my-1 flex flex-col">
            {view.weather.map((w) => (
              <WeatherRow key={w.id} w={w} now={now} />
            ))}
            {view.fires.map((f) => (
              <FireRow key={f.id} f={f} />
            ))}
          </ul>
        ) : (
          <div className="text-[13px] text-ink-faint">
            {view.fetched_at
              ? `Nothing from the Bureau of Meteorology${view.town ? ` for the ${view.town} area` : ""}${view.fires_followed ? `, and no fires within ${view.radius_km} km` : ""}.`
              : "Checking the Bureau of Meteorology and the Fire Department…"}
          </div>
        )
      ) : (
        <div className="text-[13px] text-ink-muted">
          <Link to="/settings/integrations/grid" className="text-brand no-underline hover:underline">
            Turn them on
          </Link>{" "}
          for severe weather and bushfire warnings near you.
        </div>
      )}
      {view.enabled && (
        <div className="text-xs text-ink-faint">
          Severe weather, floods{view.fires_followed ? " and fires" : ""} are what usually take the power out.
          {view.fetched_at && ` Checked ${hhmm(view.fetched_at)}.`}
        </div>
      )}
    </Card>
  );
}
