import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent, type ReactNode } from "react";
import { ApiError, errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input, Select } from "~/features/common/ui/components/Field";
import { Pill } from "~/features/common/ui/components/Pill";
import { useToast } from "~/features/common/ui/components/Toast";
import { cn } from "~/features/common/ui/utils";
import { ChoiceTiles, SettingsSection } from "~/features/settings/components/SettingsSection";
import { connectInverter, scanQuery, startScan } from "~/features/integrations/api";
import type {
  ConnectedInverter,
  ConnectRequest,
  ConnectResult,
  FoundDevice,
  IntegrationsOverview,
  InverterRole,
} from "~/features/integrations/types";
import { BRAND_ABOUT, brandSlug, deviceName, ROLE_NAME } from "~/features/integrations/utils";

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
          ? `${found.brand ?? "Inverter"} device`
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
            Not a model WattsMyPower knows by name yet. {found.brand ?? "Its maker"}&apos;s models in this family share
            their registers, so it should read fine: if anything looks wrong, an issue with its type code gets it
            sorted.
          </span>
        )}
        {found.verified === false && found.supported && !found.connected_as && (
          <span className="text-xs text-ink-muted">
            Read from {found.brand ?? "its maker"}&apos;s documented registers, but not yet tried on a real one. If
            anything looks off, an issue saying so gets it checked.
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

/** What scanning does, and where an inverter's address can be found: for every brand, or for one. */
const scanSub = (brand?: string) =>
  brand
    ? `Checks each address on your network for a ${brand} inverter, then asks what's there. Takes up to a minute.`
    : "Checks each address for an inverter (Sungrow's Modbus port, GoodWe's dongle, Fronius' Solar API), then asks what's there. Takes up to a minute.";
const manualSub = (brand?: string) =>
  `The dongle's IP address is in your router's list of connected devices, or in the inverter's app (${
    (brand && BRAND_ABOUT[brand]?.app) || "iSolarCloud, SEMS, Solar.web"
  }).`;

/** Scanning the home network for inverters, and what it found: of `brand` only, when given (the others it found are
 * pointed to their own brand's page). */
function Scan({
  overview,
  busy,
  onConnect,
  brand,
  bare,
}: {
  overview: IntegrationsOverview;
  busy: boolean;
  onConnect: (f: FoundDevice) => void;
  brand?: string;
  /** Without its own heading: it's in a section that has one. */
  bare?: boolean;
}) {
  const qc = useQueryClient();
  const [network, setNetwork] = useState(overview.network);
  const { data: scan } = useQuery(scanQuery);
  const start = useMutation({
    mutationFn: () => startScan(network.trim()),
    onSuccess: (s) => qc.setQueryData(scanQuery.queryKey, s),
  });
  const running = !!scan?.running || start.isPending;
  const all = scan?.found ?? [];
  const found = brand ? all.filter((f) => f.brand === brand) : all;
  // Another brand's inverter, found while looking for this one: connected from its own brand's page.
  const elsewhere = brand ? all.filter((f) => f.supported && f.brand && f.brand !== brand && !f.connected_as) : [];
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
      {!bare && (
        <div className="flex flex-col gap-1">
          <h3 className="text-[15px] font-semibold">Find inverters on your network</h3>
          <span className="text-[13px] text-ink-muted">{scanSub(brand)}</span>
        </div>
      )}
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
              ? `Asking ${all.length || "each"} ${all.length === 1 ? "device" : "devices"} what ${all.length === 1 ? "it is" : "they are"}…`
              : `Checked ${checked} of ${total} addresses on ${scan?.network}`}
          </span>
        </div>
      )}
      {scan?.error && <HelpText tone="bad">The scan stopped: {scan.error}</HelpText>}

      {found.length > 0 && (
        <div className="rounded-2xl border border-line-subtle px-5">
          {found.map((f) => (
            <FoundRow
              key={`${f.host}:${f.port}`}
              found={f}
              devices={overview.devices}
              busy={busy}
              onConnect={onConnect}
            />
          ))}
        </div>
      )}
      {done && !running && found.length === 0 && !scan.error && (
        <div className="rounded-xl bg-canvas px-[18px] py-4 text-sm leading-[22px] text-ink-muted">
          Nothing on {scan.network} answered like {brand ? `a ${brand}` : "an"} inverter. Check the inverter's dongle is
          on this network (its address is in your router's device list or the inverter's app), or enter its address
          below.
        </div>
      )}
      {done && !running && elsewhere.length > 0 && (
        <p className="m-0 text-[13px] leading-5 text-ink-muted">
          Also found:{" "}
          {elsewhere.map((f, n) => (
            <span key={`${f.host}:${f.port}`}>
              {n > 0 && ", "}
              {deviceName(f)} at {f.host} (
              <Link
                to="/integrations/inverters/$brand/connect"
                params={{ brand: brandSlug(f.brand) }}
                className="text-brand"
              >
                connect it from {f.brand}
              </Link>
              )
            </span>
          ))}
          .
        </p>
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
  brand: initialBrand,
  bare,
}: {
  overview: IntegrationsOverview;
  busy: boolean;
  error: unknown;
  onConnect: (role: InverterRole, body: ConnectRequest) => void;
  /** Only this brand's inverters, without choosing a brand. */
  brand?: string;
  bare?: boolean;
}) {
  const brands = [...new Set(overview.kinds.map((k) => k.brand))];
  // Given as a name ("GoodWe") or as it's written in an address ("goodwe").
  const given = initialBrand ? brands.find((b) => brandSlug(b) === brandSlug(initialBrand)) : undefined;
  const [brand, setBrand] = useState(given ?? brands[0] ?? "");
  const kinds = overview.kinds.filter((k) => k.brand === brand);
  const [driver, setDriver] = useState(kinds[0]?.driver ?? "");
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
      {!bare && (
        <div className="flex flex-col gap-1">
          <h3 className="text-[15px] font-semibold">Or enter its address</h3>
          <span className="text-[13px] text-ink-muted">{manualSub(given)}</span>
        </div>
      )}
      {!given && brands.length > 1 && (
        <ChoiceTiles
          label="Brand"
          value={brand}
          onChange={(b) => {
            setBrand(b);
            setDriver(overview.kinds.find((k) => k.brand === b)?.driver ?? "");
          }}
          min="9rem"
          phone={3}
          options={brands.map((b) => ({
            value: b,
            title: b,
            sub: overview.kinds.some((k) => k.brand === b && k.verified === false) ? "Untested" : "Tried at home",
          }))}
        />
      )}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] items-start gap-4">
        <Field label="Inverter">
          <Select value={driver} onChange={(e) => setDriver(e.target.value)}>
            {kinds.map((k) => (
              <option key={k.driver} value={k.driver}>
                {k.label} ({ROLE_NAME[k.role]})
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

/**
 * Connecting an inverter, by scanning the network or by address: in a card of its own, for any brand (the set-up
 * guide), or as two sections (`sections`: Manage → Integrations → Inverters → a brand → Connect). Given a `brand`, it's
 * that brand's inverters only.
 */
export function ConnectInverter({
  overview,
  onConnected,
  brand,
  sections,
  className,
}: {
  overview: IntegrationsOverview;
  onConnected: (device: ConnectResult) => void;
  brand?: string;
  sections?: boolean;
  className?: string;
}) {
  const connect = useConnect(onConnected);
  const [source, setSource] = useState<"scan" | "manual">();
  const busy = connect.isPending;

  const scan = (
    <>
      <Scan
        overview={overview}
        busy={busy}
        brand={brand}
        bare={sections}
        onConnect={(f) => {
          if (!f.role || !f.driver) return;
          setSource("scan");
          connect.mutate({ role: f.role, body: { driver: f.driver, host: f.host, port: f.port } });
        }}
      />
      {connect.isError && source === "scan" && <HelpText tone="bad">{errorMessage(connect.error)}</HelpText>}
    </>
  );
  const manual: ReactNode = (
    <Manual
      overview={overview}
      busy={busy && source === "manual"}
      error={source === "manual" ? connect.error : null}
      brand={brand}
      bare={sections}
      onConnect={(role, body) => {
        setSource("manual");
        connect.mutate({ role, body });
      }}
    />
  );

  if (sections)
    return (
      <>
        <SettingsSection id="h-scan" title="Find it on your network" sub={scanSub(brand)}>
          {scan}
        </SettingsSection>
        <SettingsSection id="h-manual" title="Or enter its address" sub={manualSub(brand)}>
          {manual}
        </SettingsSection>
      </>
    );
  return (
    <div className={cn("flex flex-col gap-7 p-6", className)}>
      {scan}
      <div className="border-t border-line-subtle" />
      {manual}
    </div>
  );
}
