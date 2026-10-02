import type { Standout } from "~/features/history/utils/year";

const fullDay = new Intl.DateTimeFormat("en-AU", { weekday: "short", day: "numeric", month: "long", year: "numeric" });

/** The view's record days as cards; choosing one opens it hour by hour. */
export function StandoutDays({ standouts, onSelect }: { standouts: Standout[]; onSelect: (ts: number) => void }) {
  if (!standouts.length) return null;
  return (
    <section aria-labelledby="h-standout" className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 id="h-standout">Standout days</h2>
        <span className="text-[13px] text-ink-dim">Select one to see it hour by hour</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 max-sm:grid-cols-2">
        {standouts.map((s) => (
          <button
            key={s.title}
            type="button"
            onClick={() => onSelect(s.day.ts)}
            className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-line-subtle bg-surface p-[18px] text-left transition-colors duration-200 hover:border-white/25 max-sm:p-3.5"
          >
            <span className="flex items-center gap-2 text-[13px] text-ink-dim max-sm:text-xs">
              <i className="size-1.5 flex-none rounded-full" style={{ background: s.color }} />
              {s.title}
            </span>
            <span className="text-[28px] leading-8 font-light tracking-[-1px] text-white tabular-nums max-sm:text-2xl">
              {s.value}
            </span>
            <span className="text-xs text-[#7a7a7a]">
              {s.date ?? fullDay.format(new Date(s.day.ts * 1000)).replace(/,/g, "")}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
