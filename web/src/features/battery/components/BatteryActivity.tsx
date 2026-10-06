import type { BatteryEvent } from "~/features/battery/types";
import { KIND_COLOR, when } from "~/features/battery/utils";
import { cn } from "~/features/common/ui/utils";

/** What the battery controls did lately, newest first, each with its control's colour as on the chart. */
export function BatteryActivity({ log, now, className }: { log: BatteryEvent[]; now: number; className?: string }) {
  if (!log.length) return null;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <span className="font-mono text-[11px] tracking-[1.5px] text-ink-faint uppercase">Recently</span>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[13px]">
        {log.slice(0, 5).map((e) => (
          <li key={`${e.ts}-${e.text}`} className="flex gap-3">
            <span className="w-[64px] flex-none text-ink-faint tabular-nums">{when(e.ts, now)}</span>
            <span className="flex min-w-0 items-start gap-2 text-pretty text-ink-muted">
              {e.kind && (
                <span
                  aria-hidden
                  className="mt-1.5 size-2 flex-none rounded-full"
                  style={{ background: KIND_COLOR[e.kind] }}
                />
              )}
              <span>
                {e.text}
                {e.until ? ` until ${when(e.until, e.ts)}` : ""}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
