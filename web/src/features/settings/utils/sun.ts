/*
 * Where the sun is, worked out from a place's latitude and longitude (the sunrise equation, after NOAA's): when it
 * rises, sets and is highest on a day, and how long the day is. Good to about a minute, which is plenty for showing
 * daylight; times are unix seconds.
 */

const RAD = Math.PI / 180;
const J1970 = 2440587.5;
const J2000 = 2451545;
/** The sun's middle 0.833° below the horizon: its edge, bent up by the air, is just showing. */
const HORIZON = -0.833 * RAD;
const TILT = 23.4397 * RAD;

export type SunDay = {
  /** When it rises and sets; null when it doesn't (polar day or night). */
  rise: number | null;
  set: number | null;
  /** When it's highest. */
  noon: number;
  /** Hours of daylight, 0 to 24. */
  hours: number;
};

/** The sun on the day of `ts` (any moment in it, by UTC), at `lat`, `lon` (degrees, east positive). */
export function sunDay(ts: number, lat: number, lon: number): SunDay {
  const jd = ts / 86_400 + J1970;
  const n = Math.round(jd - J2000 - 0.0009 + lon / 360);
  const mean = n + 0.0009 - lon / 360;
  const m = (357.5291 + 0.98560028 * mean) % 360;
  const mr = m * RAD;
  const c = 1.9148 * Math.sin(mr) + 0.02 * Math.sin(2 * mr) + 0.0003 * Math.sin(3 * mr);
  const l = ((m + c + 180 + 102.9372) % 360) * RAD;
  const transit = J2000 + mean + 0.0053 * Math.sin(mr) - 0.0069 * Math.sin(2 * l);
  const dec = Math.asin(Math.sin(l) * Math.sin(TILT));
  const phi = lat * RAD;
  const cosW = (Math.sin(HORIZON) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  const toTs = (j: number) => (j - J1970) * 86_400;
  if (cosW > 1) return { rise: null, set: null, noon: toTs(transit), hours: 0 };
  if (cosW < -1) return { rise: null, set: null, noon: toTs(transit), hours: 24 };
  const w = Math.acos(cosW) / (2 * Math.PI);
  return { rise: toTs(transit - w), set: toTs(transit + w), noon: toTs(transit), hours: w * 48 };
}

/** "10 h 54 min". */
export const dayLength = (hours: number) => {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m === 60 ? `${h + 1} h` : `${h} h ${m} min`;
};
