import { fullDay } from "~/features/common/formatting/utils/date";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import type { Standout } from "~/features/history/utils/year";

/** The year's record days, a row each; choosing one opens it hour by hour. */
export function StandoutDays({
  standouts,
  onSelect,
  className,
}: {
  standouts: Standout[];
  onSelect: (ts: number) => void;
  className?: string;
}) {
  if (!standouts.length) return null;
  return (
    <Card aria-labelledby="h-standout" className={className}>
      <TitleBlock id="h-standout" title="Standout days" sub="Select one to see it hour by hour" />
      <ul className="-mx-2.5 -my-1 flex flex-col">
        {standouts.map((s) => (
          <li key={s.title}>
            <button
              type="button"
              onClick={() => onSelect(s.day.ts)}
              className="group flex w-full items-center gap-3 rounded-xl border-0 bg-transparent px-2.5 py-2 text-left transition-colors duration-200 hover:bg-fg/5"
            >
              <i aria-hidden className="size-2 flex-none rounded-full" style={{ background: s.color }} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13.5px] text-ink-soft">{s.title}</span>
                <span className="truncate text-xs text-ink-faint">{s.date ?? fullDay.format(s.day.ts * 1000)}</span>
              </span>
              <span className="text-[17px] font-light text-ink tabular-nums">{s.value}</span>
              <span className="text-ink-faint transition-colors group-hover:text-ink">
                <Icon name="chevR" size={16} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
