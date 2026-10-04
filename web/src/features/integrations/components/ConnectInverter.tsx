import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { ApiError, errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input, Select } from "~/features/common/ui/components/Field";
import { Pill } from "~/features/common/ui/components/Pill";
import { useToast } from "~/features/common/ui/components/Toast";
import { cn } from "~/features/common/ui/utils";
import { connectInverter, scanQuery, startScan } from "~/features/integrations/api";
import type {
  ConnectedInverter,
  ConnectRequest,
  ConnectResult,
  FoundDevice,
  IntegrationsOverview,
  InverterRole,
} from "~/features/integrations/types";
import { deviceName, ROLE_NAME } from "~/features/integrations/utils";

/** Connect an inverter, then refresh what's connected (and the scan, which marks it connected). */
function useConnect(onConnected: (device: ConnectResult) => void) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ role, body }: { role: InverterRole; body: ConnectRequest }) => connectInverter(role, body),
    onSuccess: (device) => {
      const id = device.identified;
      toast(
        `Connected the ${id.model && id.supported ? [id.brand, id.model].filter(Boolean).join(" ") : deviceName(device)}.`,
      );
      qc.invalidateQueries({ queryKey: ["integrations"] });
      onConnected(device);
    },
  });
}

function FoundRow({
  found,
  devices,
  busy,
  onConnect,
}: {
  found: FoundDevice;
  devices: ConnectedInverter[];
  busy: boolean;
  onConnect: (f: FoundDevice) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const replaces = found.role ? devices.find((d) => d.role === found.role) : undefined;
  const title =
    found.supported && (found.model || found.label)
      ? deviceName(found)
      : found.rescan
        ? "An inverter you removed"
        : found.driver
          ? `${found.brand ?? "Sungrow"} device`
          : "Something else";
  const sub = [
    found.host,
    found.serial && `serial ${found.serial}`,
    found.nominal_kw && `${found.nominal_kw} kW`,
    found.supported && found.role && ROLE_NAME[found.role],
  ]
    .filter(Boolean)
    .join(" · ");

  let action;
  if (found.connected_as) {
    action = <Pill tone="ok">Connected</Pill>;
  } else if (found.rescan) {
    action = <span className="text-[13px] text-ink-faint">Scan again to connect it</span>;
  } else if (found.supported && found.role) {
    action =
      replaces && !confirming ? (
        <Button variant="outline" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
          Use this one instead
        </Button>
      ) : (
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={busy} onClick={() => onConnect(found)}>
            {replaces ? "Replace it" : "Connect"}
          </Button>
          {confirming && (
            <Button variant="muted-link" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          )}
        </div>
      );
  } else {
    action = (
      <span className="text-[13px] text-ink-faint">
        {found.driver ? `${found.model ?? "This model"} isn't supported yet` : "Not an inverter WattsMyPower reads"}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line-subtle py-3.5 first:border-t-0">
      <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
        <span className={found.supported ? "text-[15px] font-semibold" : "text-sm font-medium text-ink-muted"}>
          {title}
        </span>
        <span className="text-[13px] text-ink-muted tabular-nums">{sub}</span>
        {found.untested && found.supported && !found.connected_as && (
          <span className="text-xs text-ink-muted">
            Not a model WattsMyPower knows by name yet. Sungrow&apos;s hybrids share their registers, so it should read
            fine: if anything looks wrong, an issue with its type code gets it sorted.
          </span>
        )}
        {confirming && replaces && (
          <span className="text-xs text-ink-muted">
            Replaces the {deviceName(replaces)} at {replaces.host} as your {ROLE_NAME[replaces.role]}.
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

/** Scanning the home network for inverters, and what it found. */
function Scan({
  overview,
  busy,
  onConnect,
}: {
  overview: IntegrationsOverview;
  busy: boolean;
  onConnect: (f: FoundDevice) => void;
}) {
  const qc = useQueryClient();
  const [network, setNetwork] = useState(overview.network);
  const { data: scan } = useQuery(scanQuery);
  const start = useMutation({
    mutationFn: () => startScan(network.trim()),
    onSuccess: (s) => qc.setQueryData(scanQuery.queryKey, s),
  });
  const running = !!scan?.running || start.isPending;
  const found = scan?.found ?? [];
  const checked = scan?.checked ?? 0;
  const total = scan?.total ?? 0;
  const asking = running && total > 0 && checked >= total;
  const done = !!scan && !scan.running && !!scan.network;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!running) start.mutate();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-[15px] font-semibold">Find inverters on your network</h3>
        <span className="text-[13px] text-ink-muted">
          Checks each address for Sungrow's Modbus port, then asks what's there. Takes up to a minute.
        </span>
      </div>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        <Field label="Network" help="Your home network, e.g. 192.168.1.0/24" className="w-[240px] max-sm:w-full">
          <Input
            value={network}
            onChange={(e) => setNetwork(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            inputMode="decimal"
          />
        </Field>
        <Button type="submit" disabled={running || !network.trim()} className="mb-[22px] max-sm:mb-0">
          {running ? "Scanning…" : done ? "Scan again" : "Scan"}
        </Button>
      </form>
      {start.isError && <HelpText tone="bad">{errorMessage(start.error)}</HelpText>}

      {running && total > 0 && (
        <div className="flex flex-col gap-1.5" aria-live="polite">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-surface-raised"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={checked}
            aria-label="Scan progress"
          >
            <div
              className="h-full rounded-full bg-brand transition-[width] duration-500"
              style={{ width: `${Math.round((checked / total) * 100)}%` }}
            />
          </div>
          <span className="text-xs text-ink-muted tabular-nums">
            {asking
              ? `Asking ${found.length || "each"} ${found.length === 1 ? "device" : "devices"} what ${found.length === 1 ? "it is" : "they are"}…`
              : `Checked ${checked} of ${total} addresses on ${scan?.network}`}
          </span>
        </div>
      )}
      {scan?.error && <HelpText tone="bad">The scan stopped: {scan.error}</HelpText>}

      {found.length > 0 && (
        <div className="rounded-2xl border border-line-subtle px-5">
          {found.map((f) => (
            <FoundRow key={f.host} found={f} devices={overview.devices} busy={busy} onConnect={onConnect} />
          ))}
        </div>
      )}
      {done && !running && found.length === 0 && !scan.error && (
        <div className="rounded-xl bg-canvas px-[18px] py-4 text-sm leading-[22px] text-ink-muted">
          Nothing on {scan.network} answered on the Modbus port. Check the inverter's dongle is on this network (its
          address is in your router's device list or the iSolarCloud app), or enter its address below.
        </div>
      )}
    </div>
  );
}

/** Connecting by address, for an inverter the scan can't find (another network, or asleep after dark). */
function Manual({
  overview,
  busy,
  error,
  onConnect,
}: {
  overview: IntegrationsOverview;
  busy: boolean;
  error: unknown;
  onConnect: (role: InverterRole, body: ConnectRequest) => void;
}) {
  const [driver, setDriver] = useState(overview.kinds[0]?.driver ?? "");
  const [host, setHost] = useState("");
  const [tried, setTried] = useState<string | null>(null);
  const kind = overview.kinds.find((k) => k.driver === driver);
  const replaces = kind && overview.devices.find((d) => d.role === kind.role);
  const failed = tried === `${driver}@${host.trim()}` && error instanceof ApiError && error.status === 422;

  const connect = (check: boolean) => {
    if (!kind) return;
    setTried(`${driver}@${host.trim()}`);
    onConnect(kind.role, { driver, host: host.trim(), check });
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        connect(true);
      }}
    >
      <div className="flex flex-col gap-1">
        <h3 className="text-[15px] font-semibold">Or enter its address</h3>
        <span className="text-[13px] text-ink-muted">
          The dongle's IP address is in your router's list of connected devices, or in the iSolarCloud app.
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] items-start gap-4">
        <Field label="Inverter">
          <Select value={driver} onChange={(e) => setDriver(e.target.value)}>
            {overview.kinds.map((k) => (
              <option key={k.driver} value={k.driver}>
                {k.brand} {k.label} ({ROLE_NAME[k.role]})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="IP address" help={kind ? `Its ${kind.via}, e.g. on a ${kind.example}` : undefined}>
          <Input
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="192.168.1.20"
            spellCheck={false}
            autoCapitalize="off"
            inputMode="decimal"
          />
        </Field>
      </div>
      {replaces && (
        <HelpText>
          Replaces the {deviceName(replaces)} at {replaces.host} as your {ROLE_NAME[replaces.role]}.
        </HelpText>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy || !host.trim() || !kind}>
          {busy && tried === `${driver}@${host.trim()}` ? "Checking it answers…" : "Connect"}
        </Button>
        {failed && (
          <Button variant="outline" disabled={busy} onClick={() => connect(false)}>
            Connect anyway
          </Button>
        )}
      </div>
      {failed && (
        <HelpText tone="bad">
          {errorMessage(error)}{" "}
          {kind?.role === "pv2"
            ? "String inverters power down after dark: connect it anyway and it's read once it wakes."
            : "Check the address, and that nothing else (such as another app) is reading it right now."}
        </HelpText>
      )}
    </form>
  );
}

/** Connecting an inverter, by scanning the network or by address (Settings → Integrations → Sungrow, and the set-up guide). */
export function ConnectInverter({
  overview,
  onConnected,
  className,
}: {
  overview: IntegrationsOverview;
  onConnected: (device: ConnectResult) => void;
  className?: string;
}) {
  const connect = useConnect(onConnected);
  const [source, setSource] = useState<"scan" | "manual">();
  const busy = connect.isPending;

  return (
    <div className={cn("flex flex-col gap-7 p-6", className)}>
      <Scan
        overview={overview}
        busy={busy}
        onConnect={(f) => {
          if (!f.role || !f.driver) return;
          setSource("scan");
          connect.mutate({ role: f.role, body: { driver: f.driver, host: f.host, port: f.port } });
        }}
      />
      {connect.isError && source === "scan" && <HelpText tone="bad">{errorMessage(connect.error)}</HelpText>}
      <div className="border-t border-line-subtle" />
      <Manual
        overview={overview}
        busy={busy && source === "manual"}
        error={source === "manual" ? connect.error : null}
        onConnect={(role, body) => {
          setSource("manual");
          connect.mutate({ role, body });
        }}
      />
    </div>
  );
}
