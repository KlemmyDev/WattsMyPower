import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useNow } from "~/features/common/time/hooks";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText } from "~/features/common/ui/components/Field";
import { Notice } from "~/features/common/ui/components/Notice";
import { cn } from "~/features/common/ui/utils";
import { useEvChange } from "~/features/ev/hooks";
import type { EvVehicle } from "~/features/ev/types";

const LOWEST = 50; // the lowest limit a Tesla takes (and the dashboard sends)
const HIGHEST = 100;
const KEYS_SETTLE = 800; // ms after the last key press before a limit chosen with the keys is sent
const PENDING_FOR = 120; // s a limit sent is shown as being set, until the car's reading says so

const clamp = (p: number) => Math.max(LOWEST, Math.min(HIGHEST, Math.round(p)));

/**
 * The car's charge up to its limit, with the limit as a handle: drag it (or tap the bar, or use the arrow keys) to
 * change the limit, and it's sent to the car when you let go. Sending wakes an asleep car, so then it asks first.
 * Until the car's next reading shows the new limit, the handle says it's being set.
 */
export function EvChargeBar({ v, soc, fill }: { v: EvVehicle; soc: number | null; fill: string }) {
  const { command } = useEvChange();
  const s = v.state;
  const limit = s?.limit != null ? Math.round(s.limit) : null;
  const track = useRef<HTMLDivElement>(null);
  const keys = useRef<number | null>(null);
  const keyed = useRef<number | null>(null); // the limit the keys have got to, before it's sent
  const [drag, setDrag] = useState<number | null>(null);
  const [pending, setPending] = useState<{ to: number; at: number } | null>(null);
  const [ask, setAsk] = useState<number | null>(null);

  // A limit sent shows as being set until the car says it, or for a while (it may not have taken).
  const now = useNow(5_000);
  const sending = pending != null && limit !== pending.to && now - pending.at < PENDING_FOR;
  useEffect(() => () => void (keys.current && window.clearTimeout(keys.current)), []);

  const shown = drag ?? ask ?? (sending ? pending.to : null) ?? limit;
  const can = limit != null && !command.isPending;

  const send = (p: number) => {
    setAsk(null);
    command.mutate(
      { vin: v.vin, action: "limit", percent: p },
      { onSuccess: () => setPending({ to: p, at: Date.now() / 1000 }), onSettled: () => setDrag(null) },
    );
  };
  const choose = (p: number) => {
    if (p === limit) {
      setDrag(null);
      return;
    }
    if (s?.asleep) {
      setDrag(null);
      setAsk(p); // sending wakes it: ask first
    } else send(p);
  };
  const at = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    return r ? clamp(((clientX - r.left) / r.width) * 100) : (limit ?? 80);
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (!can) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setAsk(null);
    setDrag(at(e.clientX));
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (drag != null) setDrag(at(e.clientX));
  };
  const up = () => {
    if (drag != null) choose(drag);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!can) return;
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -5, PageUp: 5 }[e.key];
    const base = keyed.current ?? drag ?? shown ?? 80;
    const next = e.key === "Home" ? LOWEST : e.key === "End" ? HIGHEST : step != null ? clamp(base + step) : null;
    if (next == null) return;
    e.preventDefault();
    keyed.current = next;
    setDrag(next);
    if (keys.current) window.clearTimeout(keys.current);
    keys.current = window.setTimeout(() => {
      keyed.current = null;
      choose(next);
    }, KEYS_SETTLE);
  };

  const busy = command.isPending || sending;
  const label =
    drag != null
      ? `Limit ${drag}%`
      : busy && shown != null
        ? `Setting ${shown}%…`
        : ask != null
          ? `Limit ${ask}%`
          : null;

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={track}
        role="slider"
        tabIndex={limit != null ? 0 : -1}
        aria-label="Charge limit"
        aria-valuemin={LOWEST}
        aria-valuemax={HIGHEST}
        aria-valuenow={shown ?? undefined}
        aria-valuetext={shown != null ? `Charge limit ${shown}%` : "Charge limit not read yet"}
        aria-disabled={!can}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => setDrag(null)}
        onKeyDown={key}
        className={cn(
          "group relative py-2.5 outline-none select-none",
          can ? "cursor-pointer touch-none" : "cursor-default",
        )}
      >
        {/* The car's charge, the rest of the bar faded. */}
        <div className="relative h-3 overflow-hidden rounded-full bg-track">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700 ease-out"
            style={{ width: `${Math.min(100, soc ?? 0)}%`, background: fill }}
          />
        </div>
        {shown != null && (
          <>
            {/* The handle: a line through the bar with a knob on it, the limit over it while it's being chosen. */}
            <span
              aria-hidden
              className={cn(
                "absolute top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center",
                drag == null && "transition-[left] duration-300 ease-out",
              )}
              style={{ left: `${shown}%` }}
            >
              <span
                className={cn(
                  "size-[18px] rounded-full border-2 border-surface bg-ink shadow-sm transition-transform duration-150",
                  can &&
                    "group-hover:scale-110 group-focus-visible:scale-110 group-focus-visible:ring-2 group-focus-visible:ring-brand",
                  drag != null && "scale-125",
                  busy && "animate-pulse",
                )}
              />
            </span>
            {label && (
              <span
                aria-hidden
                className="absolute -top-6 -translate-x-1/2 rounded-full bg-ink px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap text-ink-inverse tabular-nums"
                style={{ left: `clamp(2.5rem, ${shown}%, calc(100% - 2.5rem))` }}
              >
                {label}
              </span>
            )}
          </>
        )}
      </div>
      {ask != null && (
        <Notice tone="warn" className="flex flex-wrap items-center justify-between gap-3">
          <span className="min-w-0 flex-1 text-pretty">
            <b className="font-semibold">Set the limit to {ask}%?</b> {v.name ?? "The car"} is asleep, and sending it
            wakes it.
          </span>
          <span className="flex items-center gap-3">
            <Button size="sm" disabled={command.isPending} onClick={() => send(ask)}>
              Wake and set {ask}%
            </Button>
            <Button variant="muted-link" size="sm" onClick={() => setAsk(null)}>
              Cancel
            </Button>
          </span>
        </Notice>
      )}
      {command.isError && <HelpText tone="bad">{errorMessage(command.error)}</HelpText>}
      {limit != null && ask == null && !command.isError && (
        <span className="text-xs text-ink-faint">
          Drag the handle to change the limit ({LOWEST}–{HIGHEST}%): it's sent to the car when you let go.
        </span>
      )}
    </div>
  );
}
