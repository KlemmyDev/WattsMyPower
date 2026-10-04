import { alpha, COLOR } from "~/features/common/theme/utils/colors";

/** One slot's flows (kWh): the grid (+ from it) and the battery (+ discharging). `forecast` slots are drawn fainter. */
export type Flow = { grid: number | null; bat: number | null; forecast?: boolean };

/** The bars' colours, for the charts' legends: the grid's as ever, the battery's charge light green and its discharge
 * light red. */
export const FLOW_COLOR = {
  fromGrid: COLOR.fromGrid,
  toGrid: COLOR.export,
  charge: alpha(COLOR.good, 0.5),
  discharge: alpha(COLOR.bad, 0.55),
} as const;

/** Each slot's bar, from the line out: the grid's part, then the battery's. */
function stack(f: Flow) {
  const g = f.grid ?? 0;
  const b = f.bat ?? 0;
  return {
    up: [Math.max(0, g), Math.max(0, -b)], // from the grid, then the battery charging
    down: [Math.max(0, -g), Math.max(0, b)], // sent to the grid, then the battery discharging
  };
}

/**
 * A day's grid and battery flows as one bar per slot (equal slots from midnight: half hours on the charts), on one
 * scale. Above the line, energy from the grid and the battery charging stacked on it; below, energy sent to the grid
 * and the battery discharging under it. The battery's parts go the way its level does: up as it charges, down as it
 * discharges.
 */
export function FlowBars({ slots, className }: { slots: Flow[]; className?: string }) {
  const stacks = slots.map(stack);
  const top = Math.max(0.25, ...stacks.flatMap((s) => [s.up[0] + s.up[1], s.down[0] + s.down[1]])) * 1.1;
  const pct = (kwh: number) => (kwh / top) * 50;
  return (
    <div className={className ?? "relative h-[72px] compact:h-14"}>
      <div className="absolute inset-x-0 top-1/2 border-t border-fg/12" />
      <div className="absolute inset-0 flex gap-px">
        {stacks.map((s, i) => {
          const faded = slots[i].forecast ? 0.6 : 1;
          const [gUp, bUp] = s.up.map(pct);
          const [gDown, bDown] = s.down.map(pct);
          const piece = (top: number, height: number, background: string, round: string) =>
            height >= 0.5 && (
              <span
                className={`absolute inset-x-0 ${round}`}
                style={{ top: `${top.toFixed(2)}%`, height: `${height.toFixed(2)}%`, background, opacity: faded }}
              />
            );
          return (
            <div key={i} className="relative min-w-0 flex-1">
              {piece(50 - gUp, gUp, FLOW_COLOR.fromGrid, bUp >= 0.5 ? "" : "rounded-t-[2px]")}
              {piece(50 - gUp - bUp, bUp, FLOW_COLOR.charge, "rounded-t-[2px]")}
              {piece(50, gDown, FLOW_COLOR.toGrid, bDown >= 0.5 ? "" : "rounded-b-[2px]")}
              {piece(50 + gDown, bDown, FLOW_COLOR.discharge, "rounded-b-[2px]")}
            </div>
          );
        })}
      </div>
    </div>
  );
}
