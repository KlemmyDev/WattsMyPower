import { hhmm } from "~/features/common/formatting/utils/date";
import { kW, kWh } from "~/features/common/formatting/utils/number";
import type { LiveStatus, Snapshot } from "~/features/common/live/types";
import { inverterName } from "~/features/common/live/utils";
import type { ConnectedInverter, InverterRole } from "~/features/integrations/types";

/** What an inverter is called: its model as it reported it, else the kind it was connected as. */
export function deviceName(d: Pick<ConnectedInverter, "brand" | "model" | "label">): string {
  return d.model && !d.model.startsWith("Unknown") ? inverterName(d) : [d.brand, d.label].filter(Boolean).join(" ");
}

export const ROLE_NAME: Record<InverterRole, string> = { hybrid: "main inverter", pv2: "second solar inverter" };

/** What each role does, as a line under an inverter's name. */
export const ROLE_DETAIL: Record<InverterRole, string> = {
  hybrid: "Main inverter, with the battery and meter",
  pv2: "Second solar inverter",
};

/** What removing an inverter means, shown before it's confirmed. */
export const REMOVE_NOTE: Record<InverterRole, string> = {
  hybrid: "Readings stop until another inverter is connected. Recorded history stays.",
  pv2: "Its solar stops being counted. Recorded history stays.",
};

/** A role from a URL, if it is one. */
export const asRole = (role: string): InverterRole | null => (role === "hybrid" || role === "pv2" ? role : null);

/** Its address, with the port when it isn't Modbus's usual 502: "192.168.0.244". */
export const deviceAddress = (d: Pick<ConnectedInverter, "host" | "port">) =>
  `${d.host}${d.port !== 502 ? `:${d.port}` : ""}`;

/** A connected inverter with its live state from the stream. */
export type InverterState = {
  device: ConnectedInverter;
  name: string;
  hybrid: boolean;
  /** When it last answered (unix seconds). */
  last: number | null;
  /** Answered within the last three polls. */
  ok: boolean;
  /** Answering, but with the same readings over and over since this time: its dongle has stopped refreshing them. */
  frozen: number | null;
  error: string | null;
  /** For its status pill: "Connected", "Frozen", "Not responding" or "Connecting". */
  status: string;
  /** The pill shows it as working. */
  on: boolean;
  /** "last sync 14:32", or for a second inverter what it's making now. */
  reading: string;
};

/** How a connected inverter is doing, from the live stream: the main one's status, or the second one's in `system.pv2`. */
export function inverterState(
  device: ConnectedInverter,
  live: LiveStatus | undefined,
  snapshot: Snapshot | null,
  now: number,
): InverterState {
  const hybrid = device.role === "hybrid";
  const pv2 = live?.system.pv2;
  const last = (hybrid ? live?.last_success : pv2?.last_success) ?? null;
  const error = (hybrid ? live?.error : pv2?.error) ?? null;
  const ok = !!last && now - last < (live?.poll_interval || 60) * 3;
  const frozen = (ok && hybrid && live?.frozen_since) || null;
  const reported = hybrid ? live?.system : pv2;
  const name = deviceName({
    brand: reported?.brand ?? device.brand,
    model: reported?.model ?? null,
    label: device.label,
  });
  const reading = hybrid
    ? frozen
      ? `readings frozen since ${hhmm(frozen)} – the dongle isn't refreshing them`
      : last
        ? `last sync ${hhmm(last)}`
        : "waiting for its first reading"
    : ok && snapshot
      ? `${kW(snapshot.pv2_power)} now, ${kWh(snapshot.daily_pv2)} today`
      : last
        ? `last sync ${hhmm(last)} (it powers down after dark)`
        : "waiting for its first reading (it powers down after dark)";
  return {
    device,
    name,
    hybrid,
    last,
    ok,
    frozen,
    error,
    status: frozen ? "Frozen" : ok ? "Connected" : last ? "Not responding" : "Connecting",
    on: ok && !frozen,
    reading,
  };
}

/** A brand in a URL: "Sungrow" → "sungrow", "GoodWe" → "goodwe". */
export const brandSlug = (brand: string | null | undefined) => (brand ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** What the dashboard says about each brand it reads: a line on what it reads, how to get one answering, and the
 * maker's app (where its address can be found). */
export const BRAND_ABOUT: Record<string, { about: string; setup: string; app: string }> = {
  Sungrow: {
    about: "SH-series hybrids with their battery and meter, and SG-D string inverters, over Modbus on your network.",
    setup:
      "Through its WiNet-S or WiNet-S2 dongle (or the inverter's own network port), over Modbus TCP. Nothing to turn on.",
    app: "iSolarCloud",
  },
  GoodWe: {
    about: "ET-family hybrids (ET, EH, BT, BH) with their battery and meter, and DT-family string inverters.",
    setup:
      "Through its Wi-Fi or LAN dongle, over Modbus on UDP port 8899 (newer LAN dongles take Modbus TCP on 502 too). Nothing to turn on.",
    app: "SEMS",
  },
  Fronius: {
    about:
      "A GEN24 (with its battery), or a Symo or Primo with a Fronius Smart Meter, and any Fronius as a second system.",
    setup:
      "Through its Solar API on the inverter's network port. A GEN24 ships with it off: turn it on in the inverter's web page, under Communication → Solar API. A main inverter needs a Fronius Smart Meter.",
    app: "Solar.web",
  },
};
