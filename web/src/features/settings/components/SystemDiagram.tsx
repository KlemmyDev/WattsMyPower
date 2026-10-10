import type { ReactNode } from "react";
import type { SystemInfo } from "~/features/common/live/types";
import { inverterName } from "~/features/common/live/utils";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { HouseScene } from "~/features/overview/components/HouseScene";
import { houseOptions } from "~/features/overview/utils/house/options";
import { THUMB_FLOWS } from "~/features/settings/components/HouseSettings";

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

/** One part of the system: its icon in its colour, what it is, its size, and a line under it. */
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
      className="relative z-1 flex min-w-0 flex-col gap-2 self-center rounded-2xl border border-line-subtle bg-surface p-3.5 shadow-[0_8px_24px_-12px_var(--color-shadow-pop)] max-sm:gap-1.5 max-sm:p-2.5"
      style={{ gridColumn: AT[part][0], gridRow: AT[part][1] }}
    >
      <div className="flex items-center gap-2">
        <span
          className="flex size-7 flex-none items-center justify-center rounded-full max-sm:hidden"
          style={{ background: alpha(color, 0.18), color }}
        >
          <Icon name={icon} size={15} />
        </span>
        <span className="truncate text-xs text-ink-muted max-sm:text-[11px]">{label}</span>
      </div>
      {value != null && (
        <span className="truncate text-[19px] leading-6 font-light tracking-[-0.3px] text-ink tabular-nums max-sm:text-[15px] max-sm:leading-5 max-sm:whitespace-normal">
          {value}
        </span>
      )}
      {sub && (
        <span className="truncate text-[11px] leading-4 text-ink-faint max-sm:line-clamp-2 max-sm:text-[10px] max-sm:leading-[13px] max-sm:whitespace-normal">
          {sub}
        </span>
      )}
      {children}
    </div>
  );
}

/** A line between two parts' middles, its dashes running from `from` to `to`, behind the parts. */
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
        stroke={alpha(color, 0.25)}
        strokeWidth={6}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={2}
        strokeDasharray="2 10"
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
    <div className="relative grid aspect-[4/3] grid-cols-3 grid-rows-3 gap-x-4 gap-y-3 max-sm:aspect-[5/6] max-sm:gap-x-2">
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
      <Node part="home" icon="home" color={COLOR.teal} label="Home">
        <span className="relative block aspect-[2/1] w-full overflow-hidden rounded-[10px] bg-[#dcebff]">
          <HouseScene flows={THUMB_FLOWS} sky="sunny" house={houseOptions(s)} />
        </span>
      </Node>
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
  );
}

/** The battery's capacity as a bar: what's usable, then the reserve kept back for blackouts, hatched. */
function ReserveBar({ reserve }: { reserve: number }) {
  const r = Math.min(Math.max(reserve, 0), 100);
  return (
    <span
      title={`${Math.round(r)}% kept in reserve for blackouts`}
      className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full"
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
