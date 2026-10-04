import { alpha, COLOR } from "~/features/common/theme/utils/colors";

/** One hour's flows (kWh): the grid (+ from it) and the battery (+ discharging). `forecast` hours are drawn fainter. */
export type Flow = { grid: number | null; bat: number | null; forecast?: boolean };

/** The bars' colours, for the charts' legends. */
export const FLOW_COLOR = { fromGrid: COLOR.fromGrid, toGrid: COLOR.export, battery: COLOR.battery } as const;

/**
 * A day's grid and battery flows as bars, hour by hour from midnight, each hour's two side by side: the grid
 * (from it above the line, sent to it below) and the battery (discharging into the home above, charging below).
 * Both on one scale, so their sizes compare.
 */
export function FlowBars({ hours, className }: { hours: Flow[]; className?: string }) {
  const top = Math.max(0.5, ...hours.flatMap((h) => [Math.abs(h.grid ?? 0), Math.abs(h.bat ?? 0)])) * 1.1;
  const bar = (v: number | null, up: string, down: string, faded: boolean) => {
    const x = v ?? 0;
    if (Math.abs(x) < 0.05) return <span className="flex-1" />;
    const hh = (Math.abs(x) / top) * 50;
    return (
      <span className="relative flex-1">
        <span
          className="absolute inset-x-0 rounded-[2px]"
          style={{
            top: `${(x > 0 ? 50 - hh : 50).toFixed(2)}%`,
            height: `${Math.max(1, hh).toFixed(2)}%`,
            background: x > 0 ? up : down,
            opacity: faded ? 0.55 : 1,
          }}
        />
      </span>
    );
  };
  return (
    <div className={className ?? "relative h-[72px] compact:h-14"}>
      <div className="absolute inset-x-0 top-1/2 border-t border-fg/12" />
      <div className="absolute inset-0 flex gap-0.5">
        {hours.map((h, i) => (
          <div key={i} className="flex min-w-0 flex-1 gap-px px-px">
            {bar(h.grid, FLOW_COLOR.fromGrid, FLOW_COLOR.toGrid, !!h.forecast)}
            {bar(h.bat, FLOW_COLOR.battery, alpha(FLOW_COLOR.battery, 0.55), !!h.forecast)}
          </div>
        ))}
      </div>
    </div>
  );
}
