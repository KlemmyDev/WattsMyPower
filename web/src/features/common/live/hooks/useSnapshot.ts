import { useLive } from "./useLive";

/** The latest inverter reading, or null before the first one. */
export function useSnapshot() {
  return useLive()?.snapshot ?? null;
}
