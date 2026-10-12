import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { LocationPrompt } from "~/features/common/settings/components/LocationPrompt";
import { sameDay } from "~/features/common/time/utils";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { buttonClass } from "~/features/common/ui/components/Button";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import type { FireWarning, HazardsView, NearbyWarning, WeatherWarning } from "~/features/grid/types";

/** QFD's warning levels in the Australian Warning System's colours: advice yellow, watch and act orange, emergency red. */
const FIRE_COLOR: Record<FireWarning["level"], string> = {
  Information: alpha(COLOR.fg, 0.35),
  Advice: COLOR.solar,
  "Watch and Act": COLOR.warn,
  "Emergency Warning": COLOR.danger,
};

const when = (ts: number, now: number) =>
  sameDay(ts, now) ? hhmm(ts) : `${shortDay.format(new Date(ts * 1000))} ${hhmm(ts)}`;

/** "Queensland: Southeast Coast" → "Southeast Coast". */
const areaName = (a: string) => a.replace(/^[^:]+:\s*/, "");

/** "Caboolture and Redcliffe", "Gatton, Esk and Laidley". */
const listed = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");

function WeatherRow({ w, now }: { w: WeatherWarning | NearbyWarning; now: number }) {
  const [open, setOpen] = useState(false);
  const nearby = "near" in w;
  const tone = nearby ? alpha(COLOR.fg, 0.4) : w.level === "warning" ? COLOR.warn : COLOR.solar;
  const where = nearby
    ? `Near ${listed(w.near)}, ${w.distance_km} km ${w.direction ?? "away"}`
    : w.here
      ? "Drawn over your area"
      : w.areas.map(areaName).join(", ");
  return (
    <li className="border-b border-line-subtle py-1 last:border-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="group -mx-2 flex w-[calc(100%+1rem)] cursor-pointer items-start gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-fg/4"
      >
        <span
          className="mt-0.5 flex size-6 flex-none items-center justify-center rounded-lg"
          style={{ background: alpha(tone, 0.16), color: tone }}
        >
          <Icon name={/flood|rain/i.test(w.event) ? "rain" : /fire/i.test(w.event) ? "flame" : "storm"} size={14} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn("text-[13.5px] leading-5", nearby ? "text-ink-muted" : "text-ink")}>
            {w.headline || w.event}
          </span>
          <span className="text-xs text-ink-faint">
            {where || "Bureau of Meteorology"}
            {w.expires ? ` · until ${when(w.expires, now)}` : ""}
          </span>
        </span>
        <Icon
          name="chevD"
          size={14}
          className={cn(
            "mt-1 flex-none text-ink-faint transition-[transform,color] group-hover:text-ink",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (w.description || w.url) && (
        <div className="flex flex-col items-start gap-2 pt-1 pb-1.5 pl-[34px] text-[12.5px] leading-[18px]">
          {w.description && <p className="m-0 whitespace-pre-wrap text-ink-muted">{w.description}</p>}
          {w.url && (
            <a href={w.url} target="_blank" rel="noreferrer" className={buttonClass("link", "sm", "gap-1")}>
              More from the Bureau
              <Icon name="external" size={13} />
            </a>
          )}
        </div>
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
 * The Bureau of Meteorology's warnings for the house's districts and council area, and the Fire Department's fires
 * around it: the early signs the power may go. Shown whether or not there are any. Bureau warnings for elsewhere in
 * the district come after, muted and not counted.
 */
export function HazardsCard({ view, now, className }: { view: HazardsView; now: number; className?: string }) {
  const count = view.weather.length + view.fires.filter((f) => f.level !== "Information").length;
  const bom = view.sources.bom;
  const qfd = view.sources.qfd;
  const asked = (s: typeof bom) => !!s && s.at != null;
  const sub = !view.enabled
    ? "Turned off"
    : !view.location_set
      ? "Weather and fire warnings for your area"
      : count
        ? `${count} ${count === 1 ? "warning" : "warnings"} for your area`
        : asked(bom) && (!view.fires_followed || asked(qfd))
          ? "All clear for your area"
          : "Weather and fire warnings for your area";
  // What's known, source by source: no warnings from those that answered; those that haven't, said plainly.
  const clear = [
    asked(bom) &&
      !view.weather.length &&
      `no Bureau of Meteorology warnings${view.area || view.town ? ` for the ${view.area || view.town} area` : ""}`,
    view.fires_followed && asked(qfd) && !view.fires.length && `no fires within ${view.radius_km} km`,
  ].filter(Boolean);
  return (
    <Card className={className}>
      <TitleBlock title="Warnings" sub={sub} />
      {view.enabled && !view.location_set ? (
        <LocationPrompt>Set your location to see warnings for your area.</LocationPrompt>
      ) : view.enabled ? (
        <>
          {(view.weather.length > 0 || view.fires.length > 0) && (
            <ul className="-my-1 flex flex-col">
              {view.weather.map((w) => (
                <WeatherRow key={w.id} w={w} now={now} />
              ))}
              {view.fires.map((f) => (
                <FireRow key={f.id} f={f} />
              ))}
            </ul>
          )}
          {view.nearby.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="text-xs font-medium text-ink-faint">Nearby, not for your area</div>
              <ul className="-my-1 flex flex-col">
                {view.nearby.map((w) => (
                  <WeatherRow key={w.id} w={w} now={now} />
                ))}
              </ul>
            </div>
          )}
          {clear.length > 0 && (
            <div className="text-[13px] text-ink-muted">
              {`${clear.join(", and ")}.`.replace(/^./, (c) => c.toUpperCase())}
            </div>
          )}
          <ul className="flex flex-col gap-1 text-xs text-ink-faint">
            <SourceLine name="Bureau of Meteorology" source={bom} />
            {view.fires_followed && <SourceLine name="Queensland Fire Department" source={qfd} />}
          </ul>
        </>
      ) : (
        <div className="text-[13px] text-ink-muted">
          <Link to="/integrations/grid" className="text-brand no-underline hover:underline">
            Turn them on
          </Link>{" "}
          for severe weather and bushfire warnings near you.
        </div>
      )}
    </Card>
  );
}

/** Where a source is at: checked at a time, still being asked, or not answering (and trying again). */
function SourceLine({ name, source }: { name: string; source: HazardsView["sources"]["bom"] }) {
  const state = !source || (source.at == null && !source.error) ? "asking" : source.error ? "down" : "ok";
  return (
    <li className="flex items-center gap-2">
      <i
        aria-hidden
        className={cn("size-1.5 flex-none rounded-full", state === "asking" && "animate-pulse")}
        style={{ background: state === "ok" ? COLOR.good : state === "down" ? COLOR.warn : alpha(COLOR.fg, 0.35) }}
      />
      <span>
        {name}:{" "}
        {state === "asking"
          ? "checking…"
          : state === "down"
            ? `couldn't be reached${source?.at ? `, showing what it had at ${hhmm(source.at)}` : ""}. Trying again every 10 minutes.`
            : `checked ${hhmm(source!.at!)}`}
      </span>
    </li>
  );
}
