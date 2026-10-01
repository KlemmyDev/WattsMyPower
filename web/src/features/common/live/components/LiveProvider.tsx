import { useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { liveQuery, POLL } from "~/features/common/live/api";
import type { LiveStatus } from "~/features/common/live/types";

/**
 * Keeps the live status current from the server's event stream (one message per inverter poll),
 * and refreshes every in-use query keyed under POLL when a new reading lands.
 * EventSource reconnects by itself after a dropped connection.
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  useEffect(() => {
    const es = new EventSource("/api/stream", { withCredentials: true });
    let lastTs: number | undefined;
    es.onmessage = (e) => {
      const status = JSON.parse(e.data) as LiveStatus;
      qc.setQueryData(liveQuery.queryKey, status);
      const ts = status.snapshot?.ts;
      if (lastTs !== undefined && ts !== lastTs) qc.invalidateQueries({ queryKey: [POLL] });
      lastTs = ts;
    };
    return () => es.close();
  }, [qc]);
  return children;
}
