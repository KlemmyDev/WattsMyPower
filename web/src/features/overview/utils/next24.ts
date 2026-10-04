import type { AmberPrices } from "~/features/amber/types";
import type { Forecast, ForecastHour } from "~/features/common/weather/types";
import type { SystemInfo } from "~/features/common/live/types";
import { kWh, kWhInt, money } from "~/features/common/formatting/utils/number";
import { tariffNumber } from "~/features/common/tariffs/utils";
import { hoursCost } from "~/features/plan/utils";
import { moments } from "~/features/plan/utils/moments";
import { ratesFor } from "~/features/plan/utils/rates";
import { reserveOf } from "~/features/common/energy/utils";
import { COLOR } from "~/features/common/theme/utils/colors";

/* The figures behind the Overview's "Next 24 hours" card: headline, key moments, the weather, and totals. */

const DAY = 86400;

/** `prices`: Amber's forecast, used for the expected cost when the rates follow Amber's prices. */
export function next24(f: Forecast, s: SystemInfo | undefined, now: number, prices?: AmberPrices) {
  const end = now + DAY;
  const t = s?.tariff;
  const hrs = f.hours.filter((h) => h.start < end);
  if (!hrs.length) return null;

  const fullAt = f.summary.full_at && f.summary.full_at > now && f.summary.full_at < end ? f.summary.full_at : null;

  // One weather reading every three hours, taken at the middle of each three-hour slot.
  const weather = Array.from({ length: 8 }, (_, k) => {
    const at = now + (k * 3 + 1.5) * 3600;
    const h = f.hours.find((x) => x.ts <= at && at < x.ts + 3600) || hrs[Math.min(hrs.length - 1, k * 3)];
    return { at, h };
  });

  // Totals for the next 24 hours. Home use counts any planned car charging: it's all drawn from the same place.
  const kwhOf = (h: ForecastHour, v: number) => (v * (h.ts + 3600 - h.start)) / 3600;
  const used = hrs.reduce((a, h) => a + kwhOf(h, h.load_kw + (h.car_kw ?? 0)), 0);
  const imp = hrs.reduce((a, h) => a + Math.max(0, h.grid_kwh), 0);
  const cover = used > 0 ? Math.max(0, Math.min(1, 1 - imp / used)) : 1;
  // On Amber, each hour at its forecast prices (the fallback rates where there's no forecast yet).
  const cost = t ? hoursCost(hrs, ratesFor(t, prices)) + tariffNumber(t.supply_charge) : null;
  const stats: [label: string, value: string, color: string][] = [
    ["Solar forecast", kWhInt(f.summary.pv_kwh_24h), COLOR.solar],
    ["Expected use", kWhInt(used), COLOR.ink],
    ["From the grid", kWh(imp), COLOR.ink],
    ["Expected cost", money(cost), cost != null && cost < 0 ? COLOR.good : COLOR.ink],
  ];

  return {
    headline:
      `Solar and battery should cover ${Math.round(cover * 100)}% of your power. ` +
      (imp < 0.5 ? "You should barely need the grid." : `You will need about ${kWh(imp)} from the grid.`),
    cover: cover * 100,
    gridKwh: kWh(imp),
    moments: moments(hrs, { now, end, fullAt, reserve: reserveOf(s) }),
    weather,
    stats,
  };
}
