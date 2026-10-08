import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { intAU } from "~/features/common/formatting/utils/number";
import { alpha } from "~/features/common/theme/utils/colors";
import { Icon } from "~/features/common/ui/components/Icon";
import { gridQuery } from "~/features/grid/api";
import { PLANNED, suburbsOf, UNPLANNED, when } from "~/features/grid/components/OutagesCard";
import { LEVEL } from "~/features/grid/utils";

/**
 * The grid on the Overview, compact, and only when there's something to know: the outlook's most pressing reason,
 * the outages around the house now, and planned work at its street. Opens the Grid page.
 */
export function GridOverviewCard({ now }: { now: number }) {
  const { data: grid } = useQuery(gridQuery);
  if (!grid) return null;
  const { level, reasons } = grid.outlook;
  const out = grid.outages;
  const unplanned = out?.now.filter((o) => !o.planned) ?? [];
  const mine = out?.planned.find((o) => o.affects) ?? out?.now.find((o) => o.planned && o.affects);
  if (level === "normal" && !unplanned.length && !mine) return null;
  const l = LEVEL[level];
  const top = reasons[0];
  const chips: { key: string; color: string; text: string }[] = [];
  if (unplanned.length && top?.kind !== "outages_nearby")
    chips.push({
      key: "now",
      color: UNPLANNED,
      text: `${unplanned.length} ${unplanned.length === 1 ? "outage" : "outages"} within ${out?.radius_km} km · ${intAU(out?.summary.customers ?? 0)} homes`,
    });
  if (mine && top?.kind !== "planned_here")
    chips.push({ key: "mine", color: PLANNED, text: `Planned at your street: ${when(mine, now)}` });
  if (!top && unplanned[0])
    chips.push({
      key: "near",
      color: UNPLANNED,
      text: `Nearest: ${suburbsOf(unplanned[0])}, ${unplanned[0].distance_km} km ${unplanned[0].direction}`,
    });
  return (
    <Link
      to="/grid"
      aria-label="Grid"
      className="group glass col-span-12 flex items-center gap-4 rounded-3xl border border-line-subtle px-6 py-4 text-ink no-underline transition-colors hover:border-line-strong hover:text-ink max-sm:rounded-[20px] max-sm:px-5"
      style={{ backgroundImage: `linear-gradient(100deg, ${alpha(l.color, 0.09)}, transparent 45%)` }}
    >
      <span
        className="flex size-10 flex-none items-center justify-center rounded-[13px]"
        style={{ background: alpha(l.color, 0.16), color: l.color }}
      >
        <Icon name={level === "outage" ? "bolt" : level === "normal" ? "grid" : "shield"} size={18} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <span className="text-[15px] font-semibold">{top ? top.title : l.word}</span>
          {top && <span className="line-clamp-1 min-w-0 text-[13px] text-ink-muted">{top.detail}</span>}
        </span>
        {chips.length > 0 && (
          <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
            {chips.map((c) => (
              <span key={c.key} className="flex items-center gap-1.5">
                <i aria-hidden className="size-1.5 rounded-full" style={{ background: c.color }} />
                {c.text}
              </span>
            ))}
          </span>
        )}
      </span>
      <Icon
        name="chevR"
        size={18}
        className="flex-none text-ink-faint transition-transform group-hover:translate-x-0.5"
      />
    </Link>
  );
}
