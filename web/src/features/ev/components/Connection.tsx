import { clock, hhmm } from "~/features/common/formatting/utils/date";
import { alpha } from "~/features/common/theme/utils/colors";
import { useNow } from "~/features/common/time/hooks";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { WAYS, type Reached } from "~/features/ev/components/ProviderChip";
import type { TeslaStatus } from "~/features/ev/types";

export type Freshness = Pick<TeslaStatus, "read_at" | "next_read" | "reading" | "error">;

/** How long ago a moment was: "just now", "4 min ago", or past the hour its time ("at 09:10"). */
function ago(t: number, now: number): string {
  const s = now - t;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `at ${hhmm(t)}`;
}

const CHIP =
  "inline-flex h-8 items-center gap-2 rounded-full border border-chip-line bg-chip pr-3.5 pl-2 text-[13px] leading-none whitespace-nowrap text-ink tabular-nums";

/** A ring that empties as the next check comes round (spins while it's checking), around a clock. */
function Countdown({ left, of, busy, color }: { left: number; of: number; busy: boolean; color: string }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  const share = busy ? 0.3 : Math.max(0, Math.min(1, of > 0 ? left / of : 0));
  return (
    <svg viewBox="0 0 20 20" className={cn("size-5 flex-none -rotate-90", busy && "animate-spin")} aria-hidden>
      <circle cx="10" cy="10" r={r} fill="none" strokeWidth="2.5" style={{ stroke: alpha(color, 0.18) }} />
      <circle
        cx="10"
        cy="10"
        r={r}
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - share)}
        className="transition-[stroke-dashoffset] duration-1000 ease-linear"
        style={{ stroke: color }}
      />
    </svg>
  );
}

/**
 * How the cars on the page are reached, under its title: the way (Bluetooth, Tessie, a maker's cloud) with a live dot
 * (green while reads are coming in, amber while one's under way, red when they're failing); when they were last read;
 * and a ring counting down to the next read. Ticks each second on its own, so only it draws again.
 */
export function Connection({
  status,
  provider,
  year,
}: {
  status: Freshness;
  provider: Reached | null;
  year: number | null;
}) {
  const now = useNow(1000);
  const way = provider ? WAYS[provider] : null;
  const failing = !!status.error;
  const next = status.next_read;
  const left = next != null ? next - now : null;
  // The ring's whole turn is the wait between the last read and the next.
  const of = next != null && status.read_at != null ? Math.max(1, next - status.read_at) : 1;
  const nextText = status.reading
    ? "Checking now…"
    : left == null
      ? null
      : left <= 0
        ? failing
          ? "Trying again any moment"
          : "Checking any moment"
        : `${failing ? "Trying again in" : "Next check in"} ${clock(left)}`;
  const ring = failing ? "var(--color-warn)" : (way?.color ?? "var(--color-ink-muted)");
  return (
    <span className="flex flex-wrap items-center gap-2">
      {year && <span className="mr-1 text-sm font-normal text-ink-muted tabular-nums">{year}</span>}
      {way && (
        <span className={CHIP} title={way.title}>
          <span
            className="flex size-5 items-center justify-center rounded-full"
            style={{ color: way.color, background: alpha(way.color, 0.16) }}
          >
            <Icon name={way.icon} size={13} />
          </span>
          <span className="font-semibold">{way.name}</span>
          <span className="text-ink-faint">{way.where}</span>
          <span className="mx-0.5 h-3.5 w-px bg-line" aria-hidden />
          <span
            className="live-dot"
            data-state={failing ? "error" : status.reading ? "reconnecting" : "live"}
            aria-hidden
          />
          <span className={failing ? "text-bad" : "text-ink-muted"}>
            {failing ? "Not updating" : status.reading ? "Reading" : "Connected"}
          </span>
        </span>
      )}
      {status.read_at != null && (
        <span className={CHIP} title={`Read at ${hhmm(status.read_at)}`}>
          <Icon name="clock" size={15} className="text-ink-faint" />
          <span className="text-ink-muted">Read</span> {ago(status.read_at, now)}
        </span>
      )}
      {nextText && (
        <span
          className={cn(CHIP, failing && "text-warn")}
          role="timer"
          aria-live="off"
          title={next != null && left != null && left > 0 ? `At ${hhmm(next)}` : undefined}
        >
          <Countdown left={left ?? 0} of={of} busy={status.reading} color={ring} />
          {nextText}
        </span>
      )}
    </span>
  );
}
