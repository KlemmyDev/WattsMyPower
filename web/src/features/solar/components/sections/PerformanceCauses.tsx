import { dayMonth } from "~/features/common/formatting/utils/date";
import { kWh, pct, plural } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { fromDateKey } from "~/features/common/time/utils";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import type { Causes, SolarInsights } from "~/features/solar/types";
import { performanceNote, type Tone } from "~/features/solar/utils/forecastSections";

type Cause = {
  key: string;
  icon: IconName;
  color: string;
  title: string;
  figure: string;
  /** What the readings show. */
  seen: string;
  /** What to do about it, if anything. */
  fix: string;
};

/** Each cause the readings show signs of, as what it is, what was seen, and what to do. */
export function causesOf(c: Causes | undefined): Cause[] {
  if (!c) return [];
  const out: Cause[] = [];
  if (c.dust)
    out.push({
      key: "dust",
      icon: "droplet",
      color: COLOR.link,
      title: "Dust on the panels",
      figure: `${pct(c.dust.before * 100)} → ${pct(c.dust.after * 100)}`,
      seen: `After ${c.dust.rain_mm} mm of rain on ${dayMonth(fromDateKey(c.dust.date))}, clear days went from ${pct(c.dust.before * 100)} to ${pct(c.dust.after * 100)} of what the weather allowed.`,
      fix: "If it's been dry since, a gentle clean may be worth it.",
    });
  if (c.shade)
    out.push({
      key: "shade",
      icon: "sprout",
      color: COLOR.good,
      title: `New shade in the ${c.shade.part}`,
      figure: `−${pct(c.shade.drop * 100)}`,
      seen: `${c.shade.part === "afternoon" ? "Afternoons" : "Mornings"} are ${pct(c.shade.drop * 100)} down on the rest of the day over the last two weeks. The sun's path shifting with the seasons can cause a little of this.`,
      fix: "Check for a growing tree or something new nearby.",
    });
  if (c.capped && c.capped.days)
    out.push({
      key: "capped",
      icon: "bolt",
      color: COLOR.solar,
      title: "The inverter's limit",
      figure: kWh(c.capped.kwh),
      seen: `On ${c.capped.days} ${plural(c.capped.days, "day")}, output was held at about ${c.capped.limit_kw} kW when the sun could have given more.`,
      fix: "Normal when the panels add up to more than the inverter. Nothing to do.",
    });
  return out;
}

const noteDot: Record<Tone, string> = { warn: "bg-solar", ok: "bg-good", wait: "bg-grey-500" };

/**
 * What's likely holding the panels back over the last 30 days: a line on how the clear days went, then a row for each
 * cause the readings show signs of, with what to do about it.
 */
export function PerformanceCauses({
  performance: P,
  located,
}: {
  performance: SolarInsights["performance"];
  located: boolean | undefined;
}) {
  const { tone, note } = performanceNote(P, located);
  const causes = causesOf(P?.causes);
  return (
    <Card aria-labelledby="h-pc">
      <TitleBlock
        id="h-pc"
        title="Likely causes"
        sub="What's holding your panels back, from the last 30 days' readings"
      />
      <div
        className={cn("flex items-start gap-3 rounded-xl px-4 py-3", tone === "warn" ? "bg-warn-subtle" : "bg-fg/4")}
      >
        <i className={cn("mt-[7px] size-2 flex-none rounded-full", noteDot[tone])} />
        <span className="text-[13.5px] leading-[21px] text-pretty">{note}</span>
      </div>
      {causes.length > 0 ? (
        <ul className="m-0 flex list-none flex-col p-0">
          {causes.map((c) => (
            <li
              key={c.key}
              className="flex items-start gap-3 border-t border-line-subtle py-3.5 first:border-t-0 first:pt-0"
            >
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-xl"
                style={{ background: alpha(c.color, 0.14), color: c.color }}
              >
                <Icon name={c.icon} size={17} />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{c.title}</span>
                  <span className="text-[17px] font-light whitespace-nowrap tabular-nums">{c.figure}</span>
                </div>
                <span className="text-[13px] leading-5 text-pretty text-ink-muted">{c.seen}</span>
                <span className="flex items-start gap-1.5 text-[13px] leading-5 text-ink">
                  <Icon name="arrowR" size={14} className="mt-[3px] shrink-0 text-ink-faint" />
                  {c.fix}
                </span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        tone !== "wait" && (
          <div className="text-[13px] text-ink-faint">
            No sign of dust, new shade or the inverter's limit holding output back.
          </div>
        )
      )}
    </Card>
  );
}
