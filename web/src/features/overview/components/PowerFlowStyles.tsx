import type { CSSProperties } from "react";
import { batteryTone, ON } from "~/features/common/energy/utils";
import { kW, pct } from "~/features/common/formatting/utils/number";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";
import { liveWeather, liveWeatherIcon } from "~/features/common/weather/utils";
import { Spark, parts } from "~/features/common/widgets/parts";
import type { Settings, Thumb, WidgetCtx, WidgetProps } from "~/features/common/widgets/types";
import { Card } from "~/features/common/ui/components/Card";
import { useHomeCharging } from "~/features/ev/hooks";
import { CAR_COLOR, deviceColors, liveBreakdown, OTHER_COLOR } from "~/features/home/utils";
import { PowerFlowHero } from "~/features/overview/components/PowerFlowHero";

export type FlowStyle = "scene" | "diagram" | "flow" | "ring" | "bars" | "numbers";

export const FLOW_STYLES: { value: FlowStyle; label: string; thumb: Thumb }[] = [
  { value: "scene", label: "Scene", thumb: { kind: "scene" } },
  { value: "diagram", label: "Diagram", thumb: { kind: "flow" } },
  { value: "flow", label: "Flow", thumb: { kind: "ribbons" } },
  { value: "ring", label: "Ring", thumb: { kind: "donut" } },
  { value: "bars", label: "Bars", thumb: { kind: "rows" } },
  { value: "numbers", label: "Numbers", thumb: { kind: "tiles" } },
];

/** The readings power flow can show, each switched on or off in its settings. */
export const FLOW_READINGS = [
  { key: "solar", label: "Solar" },
  { key: "home", label: "Home" },
  { key: "grid", label: "Grid" },
  { key: "battery", label: "Battery" },
  { key: "car", label: "Car" },
] as const;
type ReadingKey = (typeof FLOW_READINGS)[number]["key"];

/** Whether a reading's shown: on unless switched off, but the car only once asked for. */
export const shows = (settings: Settings, key: ReadingKey) =>
  key === "car" ? settings.car === true : settings[key] !== false;

/** One reading, ready to draw: what it's called (in a word), its figure, how full its bar is, its colour, and its line. */
type Reading = {
  key: ReadingKey;
  label: string;
  value: string;
  /** Its bar, 0–1. */
  share: number;
  color: string;
  /** It's moving power (a line in the diagram, a lit node). */
  on: boolean;
  field?: string;
  range?: [number, number];
};

/** The power as it moves now (W, all ≥ 0). */
function flows(p: WidgetCtx["p"]) {
  const g = p?.grid_power ?? 0;
  const b = p?.battery_power ?? 0;
  return {
    solar: Math.max(0, p?.pv_power ?? 0),
    home: Math.max(0, p?.load_power ?? 0),
    gridIn: Math.max(0, g),
    gridOut: Math.max(0, -g),
    batOut: Math.max(0, b),
    batIn: Math.max(0, -b),
    soc: p?.battery_soc ?? null,
  };
}
type Flows = ReturnType<typeof flows>;

function readings(f: Flows, carW: number, max: number, ctx: WidgetCtx, settings: Settings): Reading[] {
  const car = ctx.cars.find((c) => c.at_home !== false);
  const buying = f.gridIn > ON;
  const selling = f.gridOut > ON;
  const all: Reading[] = [
    {
      key: "solar",
      label: "Solar",
      value: kW(f.solar),
      share: f.solar / max,
      color: COLOR.solar,
      on: f.solar > ON,
      field: "pv_power",
    },
    {
      key: "home",
      label: "Home",
      value: kW(f.home),
      share: f.home / max,
      color: COLOR.ink,
      on: f.home > ON,
      field: "load_power",
    },
    {
      key: "grid",
      label: buying ? "Buying" : selling ? "Selling" : "Grid",
      value: kW(buying ? f.gridIn : f.gridOut),
      share: (buying ? f.gridIn : f.gridOut) / max,
      color: buying ? COLOR.import : COLOR.export,
      on: buying || selling,
      field: "grid_power",
    },
    {
      key: "battery",
      label: f.batIn > ON ? "Charging" : f.batOut > ON ? "Battery out" : "Battery",
      value: pct(f.soc),
      share: (f.soc ?? 0) / 100,
      color: batteryTone(f.batOut - f.batIn),
      on: f.batIn > ON || f.batOut > ON,
      field: "battery_soc",
      range: [0, 100],
    },
    {
      key: "car",
      label: carW > 0 ? "Car charging" : "Car",
      value: car?.soc != null ? pct(car.soc) : "—",
      share: (car?.soc ?? 0) / 100,
      color: CAR_COLOR,
      on: carW > 0,
    },
  ];
  return all.filter(
    (r) => shows(settings, r.key) && (r.key !== "battery" || f.soc != null) && (r.key !== "car" || !!car),
  );
}

/**
 * Power flow: the panels, the home, the grid, the battery and the car, now, in the style chosen: the drawing of the
 * house (scene), points joined by lines (diagram), ribbons as wide as the power (flow), the home's sources in a ring, a
 * bar each, or big figures. Which readings, and whether rooms, the weather and the last two hours go with them, are
 * the widget's to choose; each style fits itself to the widget's size, its words few and on one line.
 */
export function PowerFlowWidget({ ctx, settings, w, h }: WidgetProps) {
  const style = (settings.style as FlowStyle) ?? "scene";
  if (style === "scene") return <PowerFlowHero p={ctx.p} s={ctx.s} f={ctx.f} now={ctx.now} />;
  return <Styled ctx={ctx} settings={settings} style={style} w={w} h={h} />;
}

function Styled({
  ctx,
  settings,
  style,
  w,
  h,
}: {
  ctx: WidgetCtx;
  settings: Settings;
  style: Exclude<FlowStyle, "scene">;
  w: number;
  h: number;
}) {
  const f = flows(ctx.p);
  const carW = useHomeCharging();
  const max = Math.max(
    (ctx.s?.pv_kw ?? 0) * 1000,
    (ctx.s?.nominal_kw ?? 0) * 1000,
    f.solar,
    f.home,
    f.gridIn,
    f.gridOut,
    1,
  );
  const shown = readings(f, carW, max, ctx, settings);
  const devices = ctx.home?.devices ?? [];
  const split = settings.rooms === true ? liveBreakdown(devices, ctx.p?.load_power, { carW }) : null;
  const colors = deviceColors(devices, ctx.home?.rooms, { byRoom: true });
  const rooms = split
    ? [
        ...split.parts
          .slice(0, 4)
          .map((x) => ({ key: String(x.id), name: x.name, w: x.w, color: colors.get(x.id) ?? OTHER_COLOR })),
        { key: "other", name: "Everything else", w: split.other, color: OTHER_COLOR },
      ].filter((r) => r.w > 0)
    : [];
  const wx = ctx.p && settings.weather === true ? liveWeather(ctx.p, ctx.f, ctx.now, !!ctx.s?.temp_unit_f) : null;
  // Rooms beside the readings where it's wide, under them where it's tall, else left out.
  const roomsAt = !rooms.length ? null : w >= 8 ? "side" : h >= 6 ? "under" : null;
  return (
    <Card className="@container h-full gap-3 overflow-hidden p-5 max-sm:p-4">
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-display text-base font-bold">Power flow</span>
        {wx && (
          <span className="flex flex-none items-center gap-1.5 text-xs whitespace-nowrap text-ink-sub">
            <Icon name={liveWeatherIcon(wx)} size={14} className="text-solar" />
            <span className="@max-3xs:hidden">{wx.temp ?? wx.name}</span>
          </span>
        )}
      </div>
      <div className={cn("flex min-h-0 flex-1 gap-5", roomsAt === "side" ? "flex-row" : "flex-col")}>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {!shown.length ? (
            <span className="m-auto text-xs text-ink-faint">Choose what it shows in its settings.</span>
          ) : style === "diagram" ? (
            <Diagram shown={shown} />
          ) : style === "flow" ? (
            <Ribbons f={f} shown={shown} />
          ) : style === "ring" ? (
            <Sources f={f} shown={shown} />
          ) : style === "bars" ? (
            <Bars shown={shown} now={ctx.now} spark={settings.spark === true} />
          ) : (
            <Numbers shown={shown} now={ctx.now} spark={settings.spark === true} />
          )}
        </div>
        {roomsAt && (
          <ul
            className={cn(
              "m-0 flex list-none flex-col gap-2 p-0 text-xs",
              roomsAt === "side"
                ? "w-48 flex-none justify-center border-l border-line-subtle pl-5"
                : "border-t border-line-subtle pt-3",
            )}
          >
            {rooms.map((r) => (
              <li key={r.key} className="flex min-w-0 items-center gap-2">
                <i className="size-2 flex-none rounded-full" style={{ background: r.color }} />
                <span className="min-w-0 flex-1 truncate text-ink-sub">{r.name}</span>
                <b className="font-semibold whitespace-nowrap tabular-nums">{kW(r.w)}</b>
              </li>
            ))}
          </ul>
        )}
      </div>
      {settings.spark === true && (style === "diagram" || style === "flow" || style === "ring") && (
        <div className="relative h-7 flex-none" aria-hidden>
          <Spark field="pv_power" color={COLOR.solar} now={ctx.now} className="absolute inset-0" range={[0, max]} />
          <Spark field="load_power" color={COLOR.ink} now={ctx.now} className="absolute inset-0" range={[0, max]} />
        </div>
      )}
    </Card>
  );
}

/** The readings round the home, each joined to the middle by a line that moves while power does. */
function Diagram({ shown }: { shown: Reading[] }) {
  const at: Record<ReadingKey, [number, number]> = {
    solar: [190, 46],
    grid: [56, 150],
    home: [324, 150],
    battery: [190, 254],
    car: [324, 254],
  };
  const hub: [number, number] = [190, 150];
  return (
    <svg
      role="img"
      aria-label={shown.map((r) => `${r.label} ${r.value}`).join(", ")}
      viewBox="0 0 380 300"
      className="m-auto h-full max-h-[320px] min-h-0 w-full"
    >
      {shown.map((r) => {
        const [x, y] = at[r.key];
        return (
          <line
            key={`l-${r.key}`}
            x1={hub[0]}
            y1={hub[1]}
            x2={x}
            y2={y}
            stroke={r.on ? r.color : "var(--color-track)"}
            strokeWidth={r.on ? 3 : 2}
            strokeLinecap="round"
            strokeDasharray={r.on ? "2 10" : "3 6"}
            className={r.on ? "animate-dash" : undefined}
          />
        );
      })}
      <circle cx={hub[0]} cy={hub[1]} r={7} fill="var(--color-surface)" stroke="var(--color-ink)" strokeWidth={2} />
      {shown.map((r) => {
        const [x, y] = at[r.key];
        const [v, u] = parts(r.value);
        return (
          <g key={r.key}>
            <circle
              cx={x}
              cy={y}
              r={36}
              fill={alpha(r.color, r.on ? 0.16 : 0.06)}
              stroke={r.color}
              strokeOpacity={r.on ? 1 : 0.35}
              strokeWidth={1.5}
            />
            <text
              x={x}
              y={y + 2}
              textAnchor="middle"
              fill="var(--color-ink)"
              style={{ font: "300 19px var(--font-sans)" }}
            >
              {v}
              {u && <tspan style={{ fontSize: 10 }} fill="var(--color-ink-muted)">{` ${u}`}</tspan>}
            </text>
            <text x={x} y={y + 18} textAnchor="middle" fill={r.color} style={{ font: "500 10px var(--font-sans)" }}>
              {r.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Where each watt comes from (left) and goes (right), as ribbons as wide as the power. */
function Ribbons({ f, shown }: { f: Flows; shown: Reading[] }) {
  const want = new Set(shown.map((r) => r.key));
  const src = [
    { key: "solar", label: "Solar", v: f.solar, color: COLOR.solar },
    { key: "battery", label: "Battery", v: f.batOut, color: COLOR.solar },
    { key: "grid", label: "Grid", v: f.gridIn, color: COLOR.import },
  ].filter((x) => x.v > ON && want.has(x.key as ReadingKey));
  const dst = [
    { key: "home", label: "Home", v: f.home, color: COLOR.ink },
    { key: "battery", label: "Battery", v: f.batIn, color: COLOR.battery },
    { key: "grid", label: "Grid", v: f.gridOut, color: COLOR.export },
  ].filter((x) => x.v > ON && want.has(x.key as ReadingKey));
  const left = new Map(src.map((s) => [s.key, s.v]));
  const right = new Map(dst.map((d) => [d.key, d.v]));
  const links: { s: string; d: string; v: number }[] = [];
  for (const s of src)
    for (const d of dst) {
      if (s.key === d.key) continue;
      const v = Math.min(left.get(s.key)!, right.get(d.key)!);
      if (v <= 0) continue;
      links.push({ s: s.key, d: d.key, v });
      left.set(s.key, left.get(s.key)! - v);
      right.set(d.key, right.get(d.key)! - v);
    }
  if (!links.length) return <span className="m-auto text-xs text-ink-faint">Nothing's moving right now.</span>;
  const H = 240;
  const GAP = 16;
  const total = Math.max(1, ...[src, dst].map((xs) => xs.reduce((a, x) => a + x.v, 0)));
  const scale = (H - GAP * 2) / total;
  const stack = (xs: typeof src) => {
    let y = 0;
    return new Map(
      xs.map((x) => {
        const at = { y, h: Math.max(4, x.v * scale), color: x.color, label: x.label, v: x.v };
        y += at.h + GAP;
        return [x.key, at];
      }),
    );
  };
  const L = stack(src);
  const R = stack(dst);
  const used = { l: new Map<string, number>(), r: new Map<string, number>() };
  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <Side items={[...L.values()]} align="start" />
      <svg
        role="img"
        aria-label={links.map((l) => `${l.s} to ${l.d} ${kW(l.v)}`).join(", ")}
        viewBox={`0 0 200 ${H}`}
        preserveAspectRatio="none"
        className="h-full min-w-0 flex-1"
      >
        {links.map((l) => {
          const a = L.get(l.s)!;
          const b = R.get(l.d)!;
          const hh = l.v * scale;
          const y0 = a.y + (used.l.get(l.s) ?? 0);
          const y1 = b.y + (used.r.get(l.d) ?? 0);
          used.l.set(l.s, (used.l.get(l.s) ?? 0) + hh);
          used.r.set(l.d, (used.r.get(l.d) ?? 0) + hh);
          return (
            <path
              key={`${l.s}-${l.d}`}
              d={`M0 ${y0} C 100 ${y0} 100 ${y1} 200 ${y1} L 200 ${y1 + hh} C 100 ${y1 + hh} 100 ${y0 + hh} 0 ${y0 + hh} Z`}
              fill={alpha(b.color, 0.32)}
            />
          );
        })}
      </svg>
      <Side items={[...R.values()]} align="end" />
    </div>
  );
}

/** A side of the ribbons: each end as a bar as tall as its power, its name and figure beside it. */
function Side({
  items,
  align,
}: {
  items: { y: number; h: number; color: string; label: string; v: number }[];
  align: "start" | "end";
}) {
  const H = 240;
  return (
    <div className={cn("relative h-full w-[72px] flex-none @md:w-24", align === "end" && "text-right")}>
      {items.map((it) => (
        <div
          key={it.label}
          className="absolute inset-x-0 flex gap-2"
          style={{
            top: `${(it.y / H) * 100}%`,
            height: `${(it.h / H) * 100}%`,
            flexDirection: align === "end" ? "row-reverse" : "row",
          }}
        >
          <span className="w-1.5 flex-none rounded-full" style={{ background: it.color }} />
          <span className="flex min-w-0 flex-col justify-start leading-tight">
            <span className="truncate text-[11px]" style={{ color: it.color }}>
              {it.label}
            </span>
            <span className="text-xs font-medium whitespace-nowrap tabular-nums">{kW(it.v)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** The home's use in the middle, ringed by where it's coming from. */
function Sources({ f, shown }: { f: Flows; shown: Reading[] }) {
  const fromSolar = Math.min(f.home, f.solar);
  const fromBat = Math.min(f.home - fromSolar, f.batOut);
  const fromGrid = Math.max(0, f.home - fromSolar - fromBat);
  const total = Math.max(1, fromSolar + fromBat + fromGrid);
  const segs = [
    { label: "Solar", v: fromSolar, color: COLOR.solar },
    { label: "Battery", v: fromBat, color: COLOR.battery },
    { label: "Grid", v: fromGrid, color: COLOR.import },
  ].filter((s) => s.v > 0);
  const r = 80;
  const c = 2 * Math.PI * r;
  let at = 0;
  const [v, u] = parts(kW(f.home));
  const others = shown.filter((x) => x.key !== "home");
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center gap-6">
      <svg
        role="img"
        aria-label={`Home ${kW(f.home)}: ${segs.map((s) => `${s.label} ${Math.round((s.v / total) * 100)}%`).join(", ")}`}
        viewBox="0 0 200 200"
        className="aspect-square h-full max-h-[220px] min-h-0 flex-none"
      >
        <circle cx={100} cy={100} r={r} fill="none" stroke="var(--color-track)" strokeWidth={16} />
        {segs.map((s) => {
          const len = (s.v / total) * c;
          const el = (
            <circle
              key={s.label}
              cx={100}
              cy={100}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={16}
              strokeDasharray={`${Math.max(0, len - 3)} ${c}`}
              strokeDashoffset={-at}
              strokeLinecap="round"
              transform="rotate(-90 100 100)"
            />
          );
          at += len;
          return el;
        })}
        <text x={100} y={104} textAnchor="middle" fill="var(--color-ink)" style={{ font: "300 36px var(--font-sans)" }}>
          {v}
        </text>
        <text
          x={100}
          y={128}
          textAnchor="middle"
          fill="var(--color-ink-muted)"
          style={{ font: "500 12px var(--font-sans)" }}
        >
          {u} at home
        </text>
      </svg>
      {others.length > 0 && (
        <ul className="m-0 hidden list-none flex-col gap-2.5 p-0 text-xs @sm:flex">
          {others.map((x) => (
            <li key={x.key} className="flex items-center gap-2 whitespace-nowrap">
              <i className="size-2 rounded-full" style={{ background: x.color }} />
              <span className="text-ink-sub">{x.label}</span>
              <b className="ml-auto pl-3 font-semibold tabular-nums">{x.value}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A bar each, as a share of what the system can make (the battery and car, of full). */
function Bars({ shown, now, spark }: { shown: Reading[]; now: number; spark: boolean }) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-3.5 @xs:gap-4">
      {shown.map((r) => (
        <div key={r.key} className="flex min-w-0 flex-col gap-1.5">
          <div className="flex min-w-0 items-baseline gap-3 text-[13px]">
            <span className="min-w-0 flex-1 truncate" style={{ color: r.key === "home" ? undefined : r.color }}>
              {r.label}
            </span>
            {spark && r.field && (
              <span className="hidden w-16 @sm:block">
                <Spark field={r.field} color={r.color} now={now} range={r.range} className="h-4" />
              </span>
            )}
            <b className="font-medium whitespace-nowrap tabular-nums">{r.value}</b>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-track">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out-soft"
              style={{ width: `${Math.max(0, Math.min(1, r.share)) * 100}%`, background: r.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Big figures, one tile each, with their last two hours if asked for. */
function Numbers({ shown, now, spark }: { shown: Reading[]; now: number; spark: boolean }) {
  return (
    <div
      className="grid flex-1 auto-rows-fr grid-cols-2 gap-2 @2xl:grid-cols-[repeat(var(--n),minmax(0,1fr))] @2xl:gap-2.5"
      style={{ "--n": shown.length } as CSSProperties}
    >
      {shown.map((r) => {
        const [v, u] = parts(r.value);
        return (
          <div
            key={r.key}
            className="flex min-w-0 flex-col justify-between gap-1 overflow-hidden rounded-2xl bg-surface-raised px-3 py-2.5 @md:px-3.5 @md:py-3"
          >
            <span className="truncate text-xs" style={{ color: r.key === "home" ? "var(--color-ink-sub)" : r.color }}>
              {r.label}
            </span>
            <span className="text-[22px] leading-7 font-light tracking-[-0.5px] whitespace-nowrap tabular-nums @md:text-[30px] @md:leading-9 @2xl:text-[34px] @2xl:leading-10">
              {v}
              {u && <span className="ml-1 text-xs tracking-normal text-ink-muted">{u}</span>}
            </span>
            {spark && r.field && <Spark field={r.field} color={r.color} now={now} range={r.range} className="h-5" />}
          </div>
        );
      })}
    </div>
  );
}
