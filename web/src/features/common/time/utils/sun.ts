/*
 * Where the sun is, worked out from a place's latitude and longitude (the sunrise equation, after NOAA's): when it
 * rises, sets and is highest on a day, how long the day is, and how high it is at any moment. Good to about a minute,
 * which is plenty for showing daylight; times are unix seconds.
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

/** How high the sun is at `ts` at `lat`, `lon`: degrees above the horizon, negative below it. */
export function sunHeight(ts: number, lat: number, lon: number): number {
  const d = ts / 86_400 + J1970 - J2000;
  const m = (357.5291 + 0.98560028 * d) * RAD;
  const c = (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m)) * RAD;
  const l = m + c + 102.9372 * RAD + Math.PI;
  const dec = Math.asin(Math.sin(l) * Math.sin(TILT));
  const ra = Math.atan2(Math.sin(l) * Math.cos(TILT), Math.cos(l));
  const hour = (280.16 + 360.9856235 * d + lon) * RAD - ra;
  const phi = lat * RAD;
  return Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hour)) / RAD;
}

/** "10 h 54 min", or `short`, "10h 54m" (for a summary's figure). */
export const dayLength = (hours: number, short = false) => {
  let h = Math.floor(hours);
  let m = Math.round((hours - h) * 60);
  if (m === 60) [h, m] = [h + 1, 0];
  if (short) return m ? `${h}h ${m}m` : `${h}h`;
  return m ? `${h} h ${m} min` : `${h} h`;
};

/**
 * Where the sun is at `ts` from `lat`, `lon`: its height (degrees above the horizon, negative below it) and its bearing
 * (degrees clockwise from north), for lighting a picture by it.
 */
export function sunPlace(ts: number, lat: number, lon: number): { el: number; az: number } {
  const d = ts / 86_400 + J1970 - J2000;
  const m = (357.5291 + 0.98560028 * d) * RAD;
  const c = (1.9148 * Math.sin(m) + 0.02 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m)) * RAD;
  const l = m + c + 102.9372 * RAD + Math.PI;
  const dec = Math.asin(Math.sin(l) * Math.sin(TILT));
  const ra = Math.atan2(Math.sin(l) * Math.cos(TILT), Math.cos(l));
  const hour = (280.16 + 360.9856235 * d + lon) * RAD - ra;
  const phi = lat * RAD;
  const el = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hour)) / RAD;
  // From the south, westward; turned to a bearing from north.
  const fromSouth = Math.atan2(Math.sin(hour), Math.cos(hour) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { el, az: (((fromSouth / RAD + 180) % 360) + 360) % 360 };
}
