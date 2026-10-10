import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError, apiGet } from "~/features/common/api/utils";
import { liveQuery, POLL } from "~/features/common/live/api";
import type { LiveStatus } from "~/features/common/live/types";

/** The event stream: opening, open, or lost and being opened again. */
export type StreamState = "connecting" | "open" | "reconnecting";

const StreamContext = createContext<StreamState>("open");

/** Whether the live readings' event stream is open (see LiveProvider). */
export const useStreamState = () => useContext(StreamContext);

// How long to wait before opening a stream the browser has given up on: doubling each time, from a second to 30.
const FIRST_RETRY = 1000;
const LAST_RETRY = 30_000;

/**
 * Keeps the live status current from the server's event stream (one message per inverter poll),
 * and refreshes every in-use query keyed under POLL when a new reading lands.
 *
 * EventSource reconnects by itself after a dropped connection, but gives up for good on an error status: a 502 from a
 * proxy while the server restarts, or a 401 once the session has ended. Then it's opened again here, after a wait that
 * grows while it keeps failing; a 401 goes to the sign-in page instead (useSignOutOnExpiry).
 */
export function LiveProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [state, setState] = useState<StreamState>("connecting");
  useEffect(() => {
    let es: EventSource | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wait = FIRST_RETRY;
    let lastTs: number | undefined;
    let stopped = false;

    const take = (status: LiveStatus) => {
      qc.setQueryData(liveQuery.queryKey, status);
      const ts = status.snapshot?.ts;
      if (lastTs !== undefined && ts !== lastTs) qc.invalidateQueries({ queryKey: [POLL] });
      lastTs = ts;
    };

    const open = () => {
      es = new EventSource("/api/stream", { withCredentials: true });
      es.onopen = () => {
        wait = FIRST_RETRY;
        setState("open");
      };
      es.onmessage = (e) => take(JSON.parse(e.data) as LiveStatus);
      es.onerror = () => {
        setState("reconnecting");
        if (es?.readyState === EventSource.CLOSED) retryLater();
      };
    };

    const retryLater = () => {
      es?.close();
      timer = setTimeout(retry, wait);
      wait = Math.min(wait * 2, LAST_RETRY);
    };

    // The stream says nothing about why it failed, so first ask for the live status: a 401 there signs out, and an
    // answer means the server's back (and catches up on it) before the stream's opened again.
    const retry = async () => {
      try {
        take(await apiGet<LiveStatus>("live"));
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return;
        if (!stopped) retryLater();
        return;
      }
      if (!stopped) open();
    };

    open();
    return () => {
      stopped = true;
      clearTimeout(timer);
      es?.close();
    };
  }, [qc]);
  return <StreamContext.Provider value={state}>{children}</StreamContext.Provider>;
}
