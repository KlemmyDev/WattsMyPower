/** Inverters connected from Manage → Integrations (GET /api/integrations). Times are unix seconds. */

export type InverterRole = "hybrid" | "pv2";

/** A kind of inverter that can be connected (a driver). */
export type InverterKind = {
  driver: string;
  role: InverterRole;
  brand: string;
  label: string;
  /** How the collector reaches it, e.g. "WiNet-S or WiNet-S2 dongle". */
  via: string;
  example: string;
};

export type ConnectedInverter = {
  role: InverterRole;
  driver: string;
  host: string;
  port: number;
  unit: number;
  settings: Record<string, unknown>;
  added_at: number;
  label: string | null;
  via: string | null;
  brand: string | null;
  model: string | null;
  serial: string | null;
  nominal_kw: number | null;
  last_success: number | null;
  error: string | null;
  /** A second inverter: on the house side of the main inverter's meter. */
  behind_meter?: boolean;
};

/** Something a scan found answering on the Modbus port, and what it said it is. */
export type FoundDevice = {
  host: string;
  port: number;
  /** The driver whose probe recognised it; null if none did. */
  driver: string | null;
  role: InverterRole | null;
  label: string | null;
  via: string | null;
  brand: string | null;
  model: string | null;
  serial: string | null;
  nominal_kw: number | null;
  /** A model its driver reads. */
  supported: boolean;
  /** Read, but not a model the driver knows by name: a newer model of a family that shares its registers. */
  untested?: boolean;
  connected_as: InverterRole | null;
  /** It was connected when scanned (so not asked what it is) and has been removed since: scan again. */
  rescan: boolean;
};

export type ScanState = {
  running: boolean;
  network: string | null;
  started_at?: number;
  finished_at?: number | null;
  checked?: number;
  total?: number;
  error?: string | null;
  found?: FoundDevice[];
};

export type IntegrationsOverview = {
  /** False when there's no collector to reach (or it's out of date): `error` says why. */
  available: boolean;
  error: string | null;
  /** This dashboard can't change the collector's inverters (COLLECTOR_WRITES=false). */
  read_only: boolean;
  devices: ConnectedInverter[];
  kinds: InverterKind[];
  scan: ScanState | null;
  /** The network to suggest scanning. */
  network: string;
};

export type ConnectRequest = {
  driver: string;
  host: string;
  port?: number;
  behind_meter?: boolean;
  /** False connects it even if it doesn't answer now. */
  check?: boolean;
};

export type ConnectResult = ConnectedInverter & {
  identified: {
    brand: string | null;
    model: string | null;
    serial: string | null;
    supported: boolean;
    untested?: boolean;
  };
};
