import { useQuery } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { batteryState, gridVerb, ON } from "~/features/common/energy/utils";
import { kW } from "~/features/common/formatting/utils/number";
import { applyTheme } from "~/features/common/theme/utils";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { embedPowerQuery } from "~/features/embed/api";
import type { EmbedPower as Power, EmbedTheme, EmbedVariant } from "~/features/embed/types";

/** One figure of the summary, ready to draw in any of the looks. */
type Reading = { key: string; icon: IconName; color: string; name: string; value: string; on: boolean; bar?: number };

function readings(p: Power): Reading[] {
  const g = p.grid_w ?? 0;
  const pct = p.battery_pct;
  const bat = batteryState(p.battery_w);
  const batNote = bat === "charge" ? "Charging" : bat === "discharge" ? "Discharging" : "Idle";
  const batW = p.battery_w == null || bat === "idle" ? "" : kW(Math.abs(p.battery_w));
  const out: Reading[] = [
    { key: "solar", icon: "sun", color: COLOR.solar, name: "Solar", value: kW(p.solar_w), on: (p.solar_w ?? 0) > ON },
    { key: "home", icon: "home", color: COLOR.ink, name: "Home", value: kW(p.home_w), on: (p.home_w ?? 0) > ON },
    {
      key: "grid",
      icon: "grid",
      color: p.off_grid ? COLOR.bad : COLOR.gridSoft,
      name: gridVerb(p.grid_w, p.off_grid),
      value: p.off_grid ? "Off" : kW(p.grid_w),
      on: p.off_grid || Math.abs(g) > ON,
    },
  ];
  if (pct != null)
    out.push({
      key: "battery",
      icon: "battery",
      color: bat === "discharge" ? COLOR.warn : COLOR.batterySoft,
      name: batW ? `${batNote} ${batW}` : batNote,
      value: `${Math.round(pct)}%`,
      on: bat === "charge" || bat === "discharge",
      bar: pct,
    });
  return out;
}

/**
 * The page another website shows in a frame: solar, home, grid and battery now, read-only, on its own with nothing
 * else of the dashboard around it. The `token` in the address is what lets it read the figures (Settings → Embed);
 * `variant` is the look, `theme` light or dark (else the viewer's), and `transparent` lets the page behind show.
 */
export function EmbedPower({
  token,
  variant,
  theme,
  transparent,
}: {
  token: string;
  variant: EmbedVariant;
  theme: EmbedTheme;
  transparent: boolean;
}) {
  const { data: p, isError } = useQuery(embedPowerQuery(token));
  useEffect(() => {
    if (theme !== "auto") applyTheme(theme);
  }, [theme]);
  if (isError)
    return (
      <Shell transparent={transparent}>
        <p className="m-0 text-center text-sm text-ink-muted">This link isn't working. Ask for a new one.</p>
      </Shell>
    );
  if (!p)
    return (
      <Shell transparent={transparent}>
        <p className="m-0 text-center text-sm text-ink-faint">Loading…</p>
      </Shell>
    );
  const items = readings(p);
  const label = items.map((r) => `${r.name} ${r.value}`).join(", ");
  const look = { tiles: Tiles, compact: Compact, circuit: Circuit, stack: Stack }[variant];
  const Look = look;
  return (
    <Shell transparent={transparent}>
      <div role="img" aria-label={label}>
        <Look items={items} />
      </div>
      {p.updated != null && variant !== "compact" && (
        <p className="m-0 mt-2.5 text-center text-[11px] text-ink-faint tabular-nums">
          Updated {new Date(p.updated * 1000).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}
        </p>
      )}
    </Shell>
  );
}

function Shell({ children, transparent }: { children: ReactNode; transparent: boolean }) {
  // Transparent: the page behind shows through (the body's own colour is cleared too).
  useEffect(() => {
    if (!transparent) return;
    const was = document.body.style.background;
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    return () => {
      document.documentElement.style.background = "";
      document.body.style.background = was;
    };
  }, [transparent]);
  return (
    <main className={cn("flex min-h-dvh flex-col justify-center p-3 text-ink", !transparent && "bg-canvas")}>
      {children}
    </main>
  );
}

const tint = (r: Reading) => (r.on ? r.color : alpha(COLOR.fg, 0.45));

/** Four tiles in a row (wrapping when narrow): the default. */
function Tiles({ items }: { items: Reading[] }) {
  return (
    <div className="flex flex-wrap items-stretch justify-center gap-2.5">
      {items.map((r) => (
        <div
          key={r.key}
          className={cn(
            "flex min-w-[88px] flex-1 flex-col items-center gap-1 rounded-2xl border border-fg/6 bg-fg/4 px-3 py-3",
            !r.on && "opacity-70",
          )}
        >
          <span className="flex" style={{ color: tint(r) }}>
            <Icon name={r.icon} size={20} />
          </span>
          <span className="text-[22px] leading-6 font-light tracking-[-0.5px] tabular-nums">{r.value}</span>
          {r.bar != null && <Bar pct={r.bar} color={r.color} className="max-w-16" />}
          <span className="text-center text-xs text-ink-muted">{r.name}</span>
        </div>
      ))}
    </div>
  );
}

/** One thin strip: each figure with its icon, for a header or a footer. */
function Compact({ items }: { items: Reading[] }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-sm tabular-nums">
      {items.map((r) => (
        <span key={r.key} className="flex items-center gap-1.5" title={r.name}>
          <span className="flex" style={{ color: tint(r) }}>
            <Icon name={r.icon} size={16} />
          </span>
          <span className="font-medium">{r.value}</span>
        </span>
      ))}
    </div>
  );
}

/** The power flow as a circuit: each figure a node on one wire, the wire lit where power is moving. */
function Circuit({ items }: { items: Reading[] }) {
  return (
    <div className="flex items-start justify-center">
      {items.map((r, i) => (
        <div key={r.key} className="flex items-start">
          {i > 0 && (
            <span
              aria-hidden
              className="mt-[22px] h-0.5 w-6 flex-none rounded-full max-xs:w-3 sm:w-10"
              style={{ background: r.on || items[i - 1].on ? alpha(r.color, 0.7) : alpha(COLOR.fg, 0.15) }}
            />
          )}
          <div className="flex w-[72px] flex-none flex-col items-center gap-1">
            <span
              className="flex size-11 items-center justify-center rounded-full border"
              style={{
                color: tint(r),
                borderColor: r.on ? alpha(r.color, 0.6) : alpha(COLOR.fg, 0.15),
                background: r.on ? alpha(r.color, 0.12) : "transparent",
              }}
            >
              <Icon name={r.icon} size={20} />
            </span>
            <span className="text-[15px] font-medium tabular-nums">{r.value}</span>
            <span className="text-center text-[11px] leading-3 text-ink-muted">{r.name}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A column of rows, for a narrow sidebar: icon and name on the left, the figure on the right. */
function Stack({ items }: { items: Reading[] }) {
  return (
    <ul className="m-0 flex list-none flex-col divide-y divide-line-subtle overflow-hidden rounded-2xl border border-fg/6 bg-fg/4 p-0">
      {items.map((r) => (
        <li key={r.key} className="flex flex-col gap-1.5 px-4 py-2.5">
          <span className="flex items-center gap-3">
            <span className="flex flex-none" style={{ color: tint(r) }}>
              <Icon name={r.icon} size={18} />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">{r.name}</span>
            <span className="text-lg font-light tabular-nums">{r.value}</span>
          </span>
          {r.bar != null && <Bar pct={r.bar} color={r.color} />}
        </li>
      ))}
    </ul>
  );
}

function Bar({ pct, color, className }: { pct: number; color: string; className?: string }) {
  return (
    <span className={cn("h-1 w-full overflow-hidden rounded-full bg-track", className)}>
      <span
        className="block h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }}
      />
    </span>
  );
}
