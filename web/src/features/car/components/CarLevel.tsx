import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useCarChange, useSetLevel } from "~/features/car/hooks";
import type { CarLevel, CarView } from "~/features/car/types";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { intAU, pct } from "~/features/common/formatting/utils/number";
import { sameDay } from "~/features/common/time/utils";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { BigNumber, Muted } from "~/features/common/ui/components/Card";
import { HelpText } from "~/features/common/ui/components/Field";
import { cn } from "~/features/common/ui/utils";

/** Where the level comes from, in words: "You said 45% at 18:10, plus the planned charge since". */
export function levelSource(l: CarLevel, now: number): string {
  const at = sameDay(l.given_at, now)
    ? `at ${hhmm(l.given_at)}`
    : `on ${new Date(l.given_at * 1000).toLocaleDateString("en-AU", { weekday: "long" })}`;
  return `You said ${pct(l.given)} ${at}${l.charged ? ", plus planned charging since" : ""}`;
}

const SAVE_AFTER = 600; // ms after the last move before a level is saved

/**
 * The car's charge now and the level it's charged to, as the slider moves them. Each is saved a moment after it
 * stops moving: the charge as the car's level now, the target as the car's "charged to" level. The figures follow
 * the server again once nothing is waiting to be saved. The target never sits below the charge: moving the charge
 * past it takes it along.
 */
export function useCarLevels(view: CarView) {
  const given = view.level ? Math.round(view.level.soc) : null;
  const saved = view.car.car_target_soc;
  const [soc, setSoc] = useState<number | null>(given);
  const [target, setTarget] = useState(saved);
  const level = useSetLevel();
  const { update } = useCarChange();
  const waiting = useRef<{ soc?: number; target?: number }>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flush = () => {
    const w = waiting.current;
    waiting.current = {};
    if (w.soc != null) level.mutate({ car: view.id, soc: w.soc });
    if (w.target != null) update.mutate({ id: view.id, car_target_soc: w.target });
  };
  const later = (w: { soc?: number; target?: number }) => {
    waiting.current = { ...waiting.current, ...w };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_AFTER);
  };
  // Leaving the page part way: save what was set rather than drop it.
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      flushRef.current();
    },
    [],
  );
  useEffect(() => {
    if (waiting.current.soc == null) setSoc(given);
  }, [given]);
  useEffect(() => {
    if (waiting.current.target == null) setTarget(saved);
  }, [saved]);

  return {
    soc,
    target,
    setSoc: (v: number) => {
      setSoc(v);
      if (v > target) {
        setTarget(v);
        later({ soc: v, target: v });
      } else later({ soc: v });
    },
    setTarget: (v: number) => {
      const t = Math.max(1, v, soc ?? 0);
      setTarget(t);
      later({ target: t });
    },
    saving: level.isPending || update.isPending,
    error: level.isError ? errorMessage(level.error) : update.isError ? errorMessage(update.error) : "",
  };
}

export type CarLevels = ReturnType<typeof useCarLevels>;

/** Range at a level, from the car's battery and what it uses on the road. */
const kmAt = (view: CarView, soc: number) =>
  view.car.car_wh_per_km > 0 ? (view.car.car_battery_kwh * soc * 10) / view.car.car_wh_per_km : 0;

/**
 * The car's charge: the figure, its range and the level it's charged to, a slider with a handle for each (the
 * charge on the left, the target on the right), and where the charge came from. `big` shows the figure on its own
 * line, as the Overview's car card does.
 */
export function CarLevelSlider({
  view,
  levels,
  now,
  big,
}: {
  view: CarView;
  levels: CarLevels;
  now: number;
  big?: boolean;
}) {
  const { soc, target } = levels;
  const l = view.level;
  // Where it came from, until it's been moved here; then that it's saved.
  const moved = soc != null && (!l || soc !== Math.round(l.soc));
  const range = soc != null ? `about ${intAU(kmAt(view, soc))} km of range` : null;
  return (
    <div className="flex flex-col gap-2.5">
      {big ? (
        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
          <BigNumber>{soc != null ? pct(soc) : "—"}</BigNumber>
          <span className="pb-2 text-sm text-ink-muted tabular-nums">
            {range ? `${range} · charged to ${target}%` : "The car's charge isn't known yet"}
          </span>
        </div>
      ) : (
        <span className="text-sm text-ink-muted tabular-nums">
          <b className="text-[22px] font-light tracking-[-0.5px] text-ink">{soc != null ? pct(soc) : "—"}</b>
          {range ? ` · ${range} · charged to ${target}%` : " · the car's charge isn't known yet"}
        </span>
      )}
      <ChargeSlider soc={soc} target={target} onSoc={levels.setSoc} onTarget={levels.setTarget} />
      {levels.error ? (
        <HelpText tone="bad">{levels.error}</HelpText>
      ) : (
        <Muted className="tabular-nums">
          {soc == null
            ? "Tap the bar at the car's charge now, or drag the handle there."
            : levels.saving
              ? "Saving…"
              : moved || !l
                ? "Saved. Drag either handle to change it."
                : `${levelSource(l, now)}.`}
        </Muted>
      )}
    </div>
  );
}

type Thumb = "soc" | "target";
const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/**
 * One bar, two handles: the car's charge now (left) and the level to charge it to (right), in whole percent. The
 * bar fills to the charge, with the part still to charge shaded up to the target. Pressing anywhere on the bar takes
 * the nearer handle there and drags it; each handle also moves with the arrow keys (Page Up and Down by 10).
 */
export function ChargeSlider({
  soc,
  target,
  onSoc,
  onTarget,
  className,
}: {
  soc: number | null;
  target: number;
  onSoc: (v: number) => void;
  onTarget: (v: number) => void;
  className?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const thumbs = { soc: useRef<HTMLSpanElement>(null), target: useRef<HTMLSpanElement>(null) };
  const [drag, setDrag] = useState<Thumb | null>(null);
  const set = (t: Thumb, v: number) => (t === "soc" ? onSoc(clamp(v)) : onTarget(clamp(v)));
  const at = (e: PointerEvent) => {
    const r = bar.current!.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * 100;
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const v = at(e);
    // The nearer handle; where they meet, the one on the side the press is.
    const which: Thumb =
      soc == null
        ? "soc"
        : Math.abs(v - soc) !== Math.abs(v - target)
          ? Math.abs(v - soc) < Math.abs(v - target)
            ? "soc"
            : "target"
          : v < soc
            ? "soc"
            : "target";
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
    setDrag(which);
    thumbs[which].current?.focus({ preventScroll: true });
    set(which, v);
  };

  const key = (t: Thumb, value: number) => (e: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -10, PageUp: 10 }[e.key];
    const to = step != null ? value + step : e.key === "Home" ? 0 : e.key === "End" ? 100 : null;
    if (to == null) return;
    e.preventDefault();
    set(t, to);
  };

  const thumb = (t: Thumb, value: number, label: string, text: string) => (
    <span
      ref={thumbs[t]}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={t === "target" ? Math.max(1, soc ?? 0) : 0}
      aria-valuemax={100}
      aria-valuenow={value}
      aria-valuetext={text}
      onKeyDown={key(t, value)}
      className={cn(
        "absolute top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.3)] outline-none",
        "transition-[scale] duration-150 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        drag === t ? "scale-115 cursor-grabbing" : "cursor-grab hover:scale-110",
      )}
      style={{ left: `${value}%`, borderColor: t === "soc" ? COLOR.good : COLOR.ink, zIndex: drag === t ? 2 : 1 }}
    />
  );

  const fill = soc ?? 0;
  return (
    <div
      ref={bar}
      className={cn("relative h-7 cursor-pointer touch-pan-y select-none", className)}
      onPointerDown={down}
      onPointerMove={(e) => drag && set(drag, at(e))}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
    >
      <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 overflow-hidden rounded-full bg-track">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-good"
          style={{ width: `${fill}%`, transition: drag ? "none" : "width 300ms" }}
        />
        {target > fill && (
          <div
            className="absolute inset-y-0"
            style={{
              left: `${fill}%`,
              width: `${target - fill}%`,
              background: `repeating-linear-gradient(-45deg, ${alpha(COLOR.good, 0.35)} 0 4px, ${alpha(COLOR.good, 0.15)} 4px 8px)`,
            }}
          />
        )}
      </div>
      {soc != null && thumb("soc", soc, "The car's charge now", `${soc}%`)}
      {thumb("target", target, "Charge it to", `${target}%`)}
    </div>
  );
}
