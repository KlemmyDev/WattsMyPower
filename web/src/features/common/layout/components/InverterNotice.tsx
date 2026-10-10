import { Link, useRouterState } from "@tanstack/react-router";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Notice } from "~/features/common/ui/components/Notice";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useNow } from "~/features/common/time/hooks";
import { isFresh } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";

/**
 * Shown on every page while there's no inverter connected yet (but on Sungrow's own pages, where it's connected), while
 * it isn't answering, or while its dongle keeps sending the same readings.
 */
export function InverterNotice() {
  const st = useLive();
  const now = useNow(30_000);
  const connecting = useRouterState({ select: (s) => s.location.pathname.startsWith("/integrations/sungrow") });
  if (!st) return null;
  if (st.system.inverter_connected === false) {
    if (connecting) return null;
    return (
      <Notice tone="info" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <span className="text-pretty">
          <span className="font-medium text-ink">No inverter connected yet.</span> Readings show here once one is.
          Connect it in Manage → Integrations → Sungrow, or with the{" "}
          <Link to="/welcome" search={{ step: "inverter" }}>
            set-up guide
          </Link>
          .
        </span>
        <ButtonLink to="/integrations/sungrow/connect" variant="primary" size="sm">
          Connect one
        </ButtonLink>
      </Notice>
    );
  }
  if (st.error && !isFresh(st, now)) {
    return <Notice>Inverter not responding. Retrying automatically. ({st.error})</Notice>;
  }
  if (st.frozen_since) {
    return (
      <Notice tone="warn">
        Readings frozen since {hhmm(st.frozen_since)} – the inverter's dongle isn't refreshing them. You're seeing the{" "}
        {hhmm(st.frozen_since)} reading until it does.
      </Notice>
    );
  }
  return null;
}
