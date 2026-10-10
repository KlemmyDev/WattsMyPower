import type { ReactNode } from "react";
import type { SystemInfo } from "~/features/common/live/types";
import { inverterName } from "~/features/common/live/utils";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";

/** The figures the diagram draws: the system's, with any not saved yet in their place. */
export type DiagramFigures = {
  pvKw: number | null;
  batteryKwh: number | null;
  reservePct: number | null;
  maxKw: number | null;
};

/** Where each part sits, in a 3 by 3 grid: column, row. */
const AT = {
  solar: [1, 1],
  second: [2, 1],
  home: [3, 1],
  inverter: [2, 2],
  battery: [1, 3],
  grid: [3, 3],
} as const;
type Part = keyof typeof AT;

/** A part's middle, in % of the diagram. */
const mid = (p: Part) => [((AT[p][0] - 0.5) / 3) * 100, ((AT[p][1] - 0.5) / 3) * 100] as const;

const num = (v: number) => +v.toFixed(2);

/** One part of the system, quietly: its icon in its colour, what it is, its size, and a line under it. */
function Node({
  part,
  icon,
  color,
  label,
  value,
  sub,
  children,
}: {
  part: Part;
  icon: IconName;
  color: string;
  label: string;
  value?: ReactNode;
  sub?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className="relative z-1 flex w-full max-w-[12.5rem] min-w-0 items-center gap-2.5 self-center justify-self-center rounded-2xl bg-surface py-2.5 pr-3 pl-2.5 ring-1 ring-line-subtle max-sm:px-2 max-sm:py-2"
      style={{ gridColumn: AT[part][0], gridRow: AT[part][1] }}
    >
      <span
        className="hidden size-8 flex-none items-center justify-center rounded-full @[32rem]:flex"
        style={{ background: alpha(color, 0.14), color }}
      >
        <Icon name={icon} size={15} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-ink-muted">
          {/* The part's colour, where there's no room for its icon. */}
          <i aria-hidden className="size-1.5 flex-none rounded-full @[32rem]:hidden" style={{ background: color }} />
          <span className="truncate">{label}</span>
        </span>
        {value != null && (
          <span className="truncate text-base leading-6 font-light tracking-[-0.2px] text-ink tabular-nums max-sm:text-sm max-sm:leading-5">
            {value}
          </span>
        )}
        {sub && (
          <span className="truncate text-[11px] leading-4 text-ink-faint max-sm:text-[10px] max-sm:leading-[13px] max-sm:whitespace-normal">
            {sub}
          </span>
        )}
        {children}
      </span>
    </div>
  );
}

/** A thin line between two parts' middles, behind them, with small dots running from `from` to `to`. */
function Wire({ from, to, color }: { from: Part; to: Part; color: string }) {
  const [x1, y1] = mid(from);
  const [x2, y2] = mid(to);
  return (
    <>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={alpha(color, 0.4)}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={2.5}
        strokeDasharray="0.01 11.99"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="animate-dash"
      />
    </>
  );
}

/**
 * The installation as a diagram, for Settings → Solar and battery: the panels, inverters, battery, home and grid, each
 * with its size, joined by the wires power runs along. Figures not saved yet show as they'd be.
 */
export function SystemDiagram({ system: s, figures: f }: { system: SystemInfo; figures: DiagramFigures }) {
  const pv2 = s.pv2;
  const ratio = f.pvKw && s.nominal_kw ? f.pvKw / s.nominal_kw : null;
  const reserve = f.reservePct ?? 0;
  const usable = f.batteryKwh ? f.batteryKwh * (1 - reserve / 100) : null;
  return (
    <div className="@container">
      <div className="relative grid aspect-[4/3] grid-cols-3 grid-rows-3 gap-x-4 gap-y-3 max-sm:aspect-[5/6] max-sm:gap-x-1.5">
        <svg
          aria-hidden
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 size-full overflow-visible"
        >
          <Wire from="solar" to="inverter" color={COLOR.solar} />
          {pv2 && <Wire from="solar" to="second" color={COLOR.solar} />}
          {pv2 && <Wire from="second" to="home" color={COLOR.solar} />}
          <Wire from="inverter" to="home" color={COLOR.teal} />
          <Wire from="inverter" to="battery" color={COLOR.battery} />
          <Wire from="grid" to="inverter" color={COLOR.grid} />
        </svg>

        <Node
          part="solar"
          icon="sun"
          color={COLOR.solar}
          label="Solar array"
          value={f.pvKw ? `${num(f.pvKw)} kW` : "Not set"}
          sub={ratio ? `${ratio.toFixed(2)}× the inverter` : "All your panels"}
        />
        {pv2 && (
          <Node
            part="second"
            icon="bolt"
            color={COLOR.solar}
            label="Second inverter"
            value={pv2.nominal_kw ? `${pv2.nominal_kw} kW` : (pv2.model ?? "—")}
            sub={pv2.model ? `${inverterName(pv2)}` : pv2.host}
          />
        )}
        <Node part="home" icon="home" color={COLOR.teal} label="Home" value="Your house" sub="Where it's used" />
        <Node
          part="inverter"
          icon="bolt"
          color={COLOR.brand}
          label={s.model ?? "Inverter"}
          value={s.nominal_kw ? `${s.nominal_kw} kW` : "—"}
          sub={`${s.brand ? `${s.brand} ` : ""}hybrid inverter`}
        />
        <Node
          part="battery"
          icon="battery"
          color={COLOR.battery}
          label="Battery"
          value={f.batteryKwh ? `${num(f.batteryKwh)} kWh` : "None"}
          sub={
            usable != null
              ? `${num(usable)} kWh usable${f.maxKw ? ` · ±${num(f.maxKw)} kW` : ""}`
              : "Not reported by the inverter"
          }
        >
          {f.batteryKwh ? <ReserveBar reserve={reserve} /> : null}
        </Node>
        <Node part="grid" icon="grid" color={COLOR.grid} label="Grid" value={s.phases ?? "—"} sub="Connection" />
      </div>
    </div>
  );
}

/** The battery's capacity as a bar: what's usable, then the reserve kept back for blackouts, hatched. */
function ReserveBar({ reserve }: { reserve: number }) {
  const r = Math.min(Math.max(reserve, 0), 100);
  return (
    <span
      title={`${Math.round(r)}% kept in reserve for blackouts`}
      className="mt-1.5 flex h-1 w-full gap-[2px] overflow-hidden rounded-full"
    >
      <span
        className={cn("h-full rounded-l-full", r === 0 && "rounded-r-full")}
        style={{ width: `${100 - r}%`, background: COLOR.battery }}
      />
      {r > 0 && (
        <span
          className="h-full min-w-[3px] rounded-r-full"
          style={{
            width: `${r}%`,
            background: `repeating-linear-gradient(135deg, ${alpha(COLOR.battery, 0.55)} 0 2px, ${alpha(COLOR.battery, 0.18)} 2px 4px)`,
          }}
        />
      )}
    </span>
  );
}
