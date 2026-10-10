import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { liveQuery } from "~/features/common/live/api";
import { setSiteZone, siteZone } from "~/features/common/time/utils";

/** Current unix time in seconds, re-rendering every `intervalMs`. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * The site's time zone, taken up from the live status as soon as it arrives. Use it once, above everything that
 * draws a time: it's set as this draws, before what's below draws with it, and a component using it draws again
 * when it changes (only then: not on every reading).
 */
export function useSiteZone(): string {
  const { data: tz } = useQuery({ ...liveQuery, select: (s) => s.time_zone });
  setSiteZone(tz);
  return siteZone();
}
