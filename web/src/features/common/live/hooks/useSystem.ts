import { useLive } from "./useLive";

/** System details, settings and the tariff. */
export function useSystem() {
  return useLive()?.system;
}
