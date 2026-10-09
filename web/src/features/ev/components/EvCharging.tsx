import type { ReactNode } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { kW } from "~/features/common/formatting/utils/number";
import { Button } from "~/features/common/ui/components/Button";
import { Card, TitleBlock } from "~/features/common/ui/components/Card";
import { HelpText, Select } from "~/features/common/ui/components/Field";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { Switch } from "~/features/common/ui/components/Switch";
import { cn } from "~/features/common/ui/utils";
import { useEvChange } from "~/features/ev/hooks";
import type { EvMode, EvVehicle } from "~/features/ev/types";
import { MODE_ABOUT, MODE_LABEL } from "~/features/ev/utils";

const MODES: EvMode[] = ["off", "solar"];
const SHORT_BY = [0, 300, 500, 1000, 1500, 2000, 3000];
const LIMITS = [50, 60, 70, 75, 80, 85, 90, 95, 100];

function Row({ label, sub, children }: { label: ReactNode; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line-subtle pt-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        {sub && <span className="text-xs text-pretty text-ink-muted">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * How the dashboard charges the car (off, or from spare solar) and how it shares the sun with
 * the home battery; then the car's own controls, for now.
 */
export function EvCharging({ v, className }: { v: EvVehicle; className?: string }) {
  const { configure, command } = useEvChange();
  const c = v.control;
  const s = v.state;
  const set = (body: Parameters<typeof configure.mutate>[0]) => configure.mutate(body);
  const busy = command.isPending;
  // While the dashboard follows the sun it sets the current itself; by hand only when it's off or on hold.
  const auto = c.mode !== "off" && !v.hold;
  const amps = s?.amps ?? null;
  const step = (d: number) =>
    amps != null &&
    command.mutate({ vin: v.vin, action: "amps", amps: Math.max(1, Math.min(v.max_amps ?? 32, amps + d)) });

  return (
    <Card aria-labelledby={`h-tc-${v.vin}`} className={cn("gap-4", className)}>
      <TitleBlock id={`h-tc-${v.vin}`} title="Charging" sub="How the dashboard charges the car at home" />
      <Segmented
        label="Charging mode"
        options={MODES.map((m) => ({ value: m, label: MODE_LABEL[m] }))}
        value={c.mode}
        onChange={(mode) => set({ vin: v.vin, mode })}
        buttonClassName="flex-1"
      />
      <p className="m-0 text-[13px] leading-5 text-pretty text-ink-muted">{MODE_ABOUT[c.mode]}</p>
      {c.mode !== "off" && (
        <>
          <Row
            label="Home battery first"
            sub={
              c.battery_first
                ? "The car gets what's left once the home battery is charging at its full rate, or is full."
                : "The car gets spare solar before the home battery does."
            }
          >
            <Switch
              label="Home battery first"
              on={c.battery_first}
              disabled={configure.isPending}
              onChange={(on) => set({ vin: v.vin, battery_first: on })}
            />
          </Row>
          <Row
            label="Keep charging when short by"
            sub={`Drawn from the grid or the home battery for a passing cloud${
              v.min_w ? `: its lowest current takes ${kW(v.min_w)}` : ""
            }.`}
          >
            <Select
              aria-label="Keep charging when short by"
              className="w-28"
              value={c.grid_w}
              disabled={configure.isPending}
              onChange={(e) => set({ vin: v.vin, grid_w: Number(e.target.value) })}
            >
              {[...new Set([...SHORT_BY, c.grid_w])]
                .sort((a, b) => a - b)
                .map((w) => (
                  <option key={w} value={w}>
                    {w ? kW(w) : "Nothing"}
                  </option>
                ))}
            </Select>
          </Row>
          {s?.at_home === false && s.in_range == null && s.plugged && (
            <Row label="Charging here isn't controlled" sub="The car isn't at home. Is this home?">
              <Button size="sm" variant="outline" onClick={() => set({ vin: v.vin, home: "here" })}>
                This is home
              </Button>
            </Row>
          )}
        </>
      )}
      {configure.isError && <HelpText tone="bad">{errorMessage(configure.error)}</HelpText>}

      <div className="flex flex-col gap-3 border-t border-line-subtle pt-4">
        <span className="text-sm font-medium">Now</span>
        <div className="flex flex-wrap items-center gap-3">
          {s?.charging ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => command.mutate({ vin: v.vin, action: "stop" })}
            >
              Stop charging
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={busy || !s?.plugged || s.charging_state === "Complete"}
              onClick={() => command.mutate({ vin: v.vin, action: "start" })}
            >
              Charge now
            </Button>
          )}
          {auto ? (
            <span className="text-sm text-ink-muted tabular-nums">
              {s?.charging && amps != null ? `${amps} A, set by the sun` : "Current set by the sun"}
              {v.volts && v.phases ? ` · ${kW(v.volts * v.phases)} an amp` : ""}
            </span>
          ) : (
            <div
              className="flex items-center gap-1 rounded-full border border-chip-line bg-canvas p-1"
              role="group"
              aria-label="Charging current"
            >
              <Button
                size="sm"
                variant="chip"
                aria-label="Less current"
                disabled={busy || amps == null || amps <= 1}
                onClick={() => step(-1)}
              >
                −
              </Button>
              <span className="min-w-12 text-center text-sm tabular-nums">{amps != null ? `${amps} A` : "—"}</span>
              <Button
                size="sm"
                variant="chip"
                aria-label="More current"
                disabled={busy || amps == null || amps >= (v.max_amps ?? 32)}
                onClick={() => step(1)}
              >
                +
              </Button>
            </div>
          )}
          <Select
            aria-label="Charge limit"
            className="w-36"
            value={s?.limit ?? ""}
            disabled={busy || s?.limit == null}
            onChange={(e) => command.mutate({ vin: v.vin, action: "limit", percent: Number(e.target.value) })}
          >
            {[...new Set([...LIMITS, ...(s?.limit != null ? [Math.round(s.limit)] : [])])]
              .sort((a, b) => a - b)
              .map((p) => (
                <option key={p} value={p}>
                  Limit {p}%
                </option>
              ))}
          </Select>
        </div>
        <HelpText tone={command.isError ? "bad" : undefined}>
          {command.isPending
            ? "Waking the car…"
            : command.isError
              ? errorMessage(command.error)
              : c.mode !== "off"
                ? "The current follows the spare solar each minute, between the car's lowest and highest. Starting or stopping here or in the car's app puts it on hold until it's unplugged."
                : ""}
        </HelpText>
      </div>
    </Card>
  );
}
