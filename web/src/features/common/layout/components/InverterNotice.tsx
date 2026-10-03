import { Notice } from "~/features/common/ui/components/Notice";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useNow } from "~/features/common/time/hooks";
import { isFresh } from "~/features/common/energy/utils";
import { hhmm } from "~/features/common/formatting/utils/date";

/** Shown on every page while the inverter isn't answering, or its dongle keeps sending the same readings. */
export function InverterNotice() {
  const st = useLive();
  const now = useNow(30_000);
  if (!st) return null;
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
