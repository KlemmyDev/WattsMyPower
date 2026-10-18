import { useQuery } from "@tanstack/react-query";
import { batteryState, gridVerb, ON } from "~/features/common/energy/utils";
import { kW } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { embedPowerQuery } from "~/features/embed/api";

/**
 * The page another website shows in a frame: solar, home, grid and battery now, read-only, on its own with nothing
 * else of the dashboard around it. The `token` in the address is what lets it read the figures (Settings → Embed).
 */
export function EmbedPower({ token }: { token: string }) {
  const { data: p, isError } = useQuery(embedPowerQuery(token));
  if (isError)
    return (
      <Shell>
        <p className="m-0 text-center text-sm text-ink-muted">This link isn't working. Ask for a new one.</p>
      </Shell>
    );
  if (!p)
    return (
      <Shell>
        <p className="m-0 text-center text-sm text-ink-faint">Loading…</p>
      </Shell>
    );
  const g = p.grid_w ?? 0;
  const pct = p.battery_pct;
  const bat = batteryState(p.battery_w);
  const batNote = bat === "charge" ? "Charging" : bat === "discharge" ? "Discharging" : "Idle";
  const batW = p.battery_w == null ? "" : bat === "idle" ? "" : kW(Math.abs(p.battery_w));
  const label = [
    `Solar ${kW(p.solar_w)}`,
    `home ${kW(p.home_w)}`,
    `${gridVerb(p.grid_w).toLowerCase()} ${kW(p.grid_w)}`,
    pct != null ? `battery ${Math.round(pct)}% ${batNote.toLowerCase()}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Shell>
      <div role="img" aria-label={label} className="flex flex-wrap items-stretch justify-center gap-2.5">
        <Tile icon="sun" color={COLOR.solar} name="Solar" value={kW(p.solar_w)} on={(p.solar_w ?? 0) > ON} />
        <Tile icon="home" color={COLOR.ink} name="Home" value={kW(p.home_w)} on={(p.home_w ?? 0) > ON} />
        <Tile
          icon="grid"
          color={COLOR.gridSoft}
          name={gridVerb(p.grid_w) === "Grid" ? "Grid" : gridVerb(p.grid_w)}
          value={kW(p.grid_w)}
          on={Math.abs(g) > ON}
        />
        {pct != null && (
          <Tile
            icon="battery"
            color={bat === "discharge" ? COLOR.warn : COLOR.batterySoft}
            name={batW ? `${batNote} ${batW}` : batNote}
            value={`${Math.round(pct)}%`}
            on={bat !== "idle" && bat != null}
            bar={pct}
          />
        )}
      </div>
      {p.updated != null && (
        <p className="m-0 mt-2.5 text-center text-[11px] text-ink-faint tabular-nums">
          Updated {new Date(p.updated * 1000).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}
        </p>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-dvh flex-col justify-center bg-canvas p-3 text-ink">{children}</main>;
}

function Tile({
  icon,
  color,
  name,
  value,
  on,
  bar,
}: {
  icon: IconName;
  color: string;
  name: string;
  value: string;
  on: boolean;
  /** A battery level, as a bar under the figure. */
  bar?: number;
}) {
  return (
    <div
      className={cn(
        "flex min-w-[88px] flex-1 flex-col items-center gap-1 rounded-2xl border border-fg/6 bg-fg/4 px-3 py-3",
        !on && "opacity-70",
      )}
    >
      <span className="flex" style={{ color: on ? color : alpha(COLOR.fg, 0.45) }}>
        <Icon name={icon} size={20} />
      </span>
      <span className="text-[22px] leading-6 font-light tracking-[-0.5px] tabular-nums">{value}</span>
      {bar != null && (
        <span className="h-1 w-full max-w-16 overflow-hidden rounded-full bg-track">
          <span
            className="block h-full rounded-full"
            style={{ width: `${Math.max(0, Math.min(100, bar))}%`, background: color }}
          />
        </span>
      )}
      <span className="text-center text-xs text-ink-muted">{name}</span>
    </div>
  );
}
