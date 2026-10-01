/** Time helpers in unix seconds, using the browser's local time zone. */

export const nowS = () => Math.floor(Date.now() / 1000);

export function midnight(ts: number): number {
  const d = new Date(ts * 1000);
  d.setHours(0, 0, 0, 0);
  return d.getTime() / 1000;
}

export function addDays(ts: number, n: number): number {
  const d = new Date(ts * 1000);
  d.setDate(d.getDate() + n);
  return d.getTime() / 1000;
}

export const sameDay = (a: number, b: number) => midnight(a) === midnight(b);

/** Unix seconds as a local "YYYY-MM-DD". */
export function dateKey(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local "YYYY-MM-DD" as unix seconds at midnight. */
export function fromDateKey(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).getTime() / 1000;
}

export const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;

export function greeting(d = new Date()): string {
  const h = d.getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
