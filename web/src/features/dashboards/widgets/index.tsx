import { useQuery } from "@tanstack/react-query";
import { batteryState, batteryTone, energyToday, ON } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";
import { centsShort, kW, kWh, money, pct } from "~/features/common/formatting/utils/number";
import { costsQuery } from "~/features/common/readings/api";
import { COLOR } from "~/features/common/theme/utils/colors";
import { dateKey, midnight } from "~/features/common/time/utils";
import { Big, Spark, WidgetCard, parts } from "~/features/common/widgets/parts";
import type { Choice, WidgetDef, WidgetProps } from "~/features/common/widgets/types";
import { rateAt } from "~/features/home/components/RateStrip";
import { useRates } from "~/features/home/hooks";

/** The readings a single-figure widget can show. */
export const METRICS: (Choice & { group: string })[] = [
  { value: "solar", label: "Solar now", group: "Now" },
  { value: "home", label: "Home now", group: "Now" },
  { value: "grid", label: "Grid now", group: "Now" },
  { value: "battery", label: "Battery level", group: "Now" },
  { value: "battery-power", label: "Battery charging or using", group: "Now" },
  { value: "price", label: "Power costs now", group: "Now" },
  { value: "solar-today", label: "Solar made today", group: "Today" },
  { value: "home-today", label: "Home used today", group: "Today" },
  { value: "bought-today", label: "Bought from the grid today", group: "Today" },
  { value: "sold-today", label: "Sold to the grid today", group: "Today" },
  { value: "self-today", label: "Self-sufficiency today", group: "Today" },
  { value: "cost-today", label: "Cost today", group: "Today" },
  { value: "saved-today", label: "Saved today", group: "Today" },
];

/** One reading, big, with what it is, a word on it, and (for a power) its last two hours. */
function FigureWidget({ ctx, settings, h }: WidgetProps) {
  const metric = (settings.metric as string) ?? "home";
  const p = ctx.p;
  const e = energyToday(p);
  const rates = useRates(midnight(ctx.now));
  const rate = rateAt(rates, ctx.now);
  const { data: costs } = useQuery(costsQuery(midnight(ctx.now)));
  const today = costs?.days.find((d) => d.date === dateKey(ctx.now));
  const g = p?.grid_power ?? null;
  const b = p?.battery_power ?? null;
  const st = batteryState(b);
  type Shown = { label: string; value: string; sub?: string; color: string; field?: string; range?: [number, number] };
  const shown: Record<string, Shown> = {
    solar: {
      label: "Solar now",
      value: kW(p ? Math.max(0, p.pv_power ?? 0) : null),
      color: COLOR.solar,
      field: "pv_power",
    },
    home: {
      label: "Home now",
      value: kW(p ? Math.max(0, p.load_power ?? 0) : null),
      color: COLOR.teal,
      field: "load_power",
    },
    grid: {
      label: g == null ? "Grid" : g > ON ? "Buying from the grid" : g < -ON ? "Selling to the grid" : "Grid",
      value: kW(g == null ? null : Math.abs(g)),
      color: g != null && g > ON ? COLOR.import : COLOR.export,
      field: "grid_power",
    },
    battery: {
      label: "Battery",
      value: pct(p?.battery_soc),
      color: COLOR.battery,
      field: "battery_soc",
      range: [0, 100],
    },
    "battery-power": {
      label: st === "charge" ? "Battery charging" : st === "discharge" ? "Battery in use" : "Battery",
      value: st === "idle" ? "Idle" : kW(Math.abs(b ?? 0)),
      color: batteryTone(b),
      field: "battery_power",
    },
    price: {
      label: "Power costs now",
      value: rate ? `${centsShort(rate.rate)} /kWh` : "—",
      sub: rate ? (rates!.length > 1 ? `${rate.name} until ${hhmm(rate.to)}` : rate.name) : undefined,
      color: rate?.color ?? COLOR.ink,
    },
    "solar-today": { label: "Solar made today", value: kWh(e?.pv), color: COLOR.solar },
    "home-today": { label: "Home used today", value: kWh(e?.home), color: COLOR.teal },
    "bought-today": { label: "Bought today", value: kWh(e?.imp), color: COLOR.import },
    "sold-today": { label: "Sold today", value: kWh(e?.exp), color: COLOR.export },
    "self-today": {
      label: "Self-sufficiency today",
      value: e && e.home > 0 ? pct(Math.max(0, 1 - e.imp / e.home) * 100) : "—",
      color: COLOR.good,
    },
    "cost-today": { label: "Cost today", value: money(today?.net_cost), color: COLOR.ink },
    "saved-today": { label: "Saved today", value: money(today?.saved), color: COLOR.good },
  };
  const s = shown[metric] ?? shown.home;
  const [v, u] = s.value.startsWith("$") ? [s.value, ""] : parts(s.value);
  return (
    <WidgetCard title={s.label} className="justify-between">
      <Big value={v} unit={u} />
      {s.sub && <span className="text-xs text-ink-muted">{s.sub}</span>}
      {settings.spark !== false && s.field && h >= 2 && (
        <Spark field={s.field} color={s.color} now={ctx.now} range={s.range} />
      )}
    </WidgetCard>
  );
}

/** The dashboard's own widget: any one reading, whichever feature it's from. */
export const widgets: WidgetDef[] = [
  {
    type: "figure",
    name: "A single figure",
    sub: "Any reading you choose, big, with its last two hours",
    group: "general",
    icon: "pulse",
    thumb: { kind: "number", value: "788 W", color: COLOR.ink },
    sizes: { min: [2, 2], max: [6, 3], default: [3, 2] },
    phone: { min: [2, 2], max: [4, 3], default: [2, 2] },
    options: [
      {
        key: "metric",
        label: "Shows",
        kind: "select",
        // the battery's readings only where there's a battery
        choices: (ctx) => (ctx.noBattery ? METRICS.filter((m) => !m.value.startsWith("battery")) : METRICS),
        default: "home",
      },
      { key: "spark", label: "Last two hours", sub: "For a reading of power", kind: "toggle", default: true },
    ],
    Component: FigureWidget,
  },
];
