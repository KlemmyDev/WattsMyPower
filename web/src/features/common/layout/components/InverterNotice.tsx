import { Notice } from "~/features/common/ui/components/Notice";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useNow } from "~/features/common/time/hooks";
import { isFresh } from "~/features/common/energy/utils";

/** Shown on every page while the inverter isn't answering. */
export function InverterNotice() {
  const st = useLive();
  const now = useNow(30_000);
  if (!st?.error || isFresh(st, now)) return null;
  return <Notice>Inverter not responding. Retrying automatically. ({st.error})</Notice>;
}
