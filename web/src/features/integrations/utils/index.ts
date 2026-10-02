import { inverterName } from "~/features/common/live/utils";
import type { ConnectedInverter, InverterRole } from "~/features/integrations/types";

/** What an inverter is called: its model as it reported it, else the kind it was connected as. */
export function deviceName(d: Pick<ConnectedInverter, "brand" | "model" | "label">): string {
  return d.model && !d.model.startsWith("Unknown") ? inverterName(d) : [d.brand, d.label].filter(Boolean).join(" ");
}

export const ROLE_NAME: Record<InverterRole, string> = { hybrid: "main inverter", pv2: "second solar inverter" };
