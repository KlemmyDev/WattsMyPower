import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { hhmm, longDate } from "~/features/common/formatting/utils/date";
import { kW, kWh } from "~/features/common/formatting/utils/number";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Button, ButtonLink } from "~/features/common/ui/components/Button";
import { HelpText, Input, Select } from "~/features/common/ui/components/Field";
import { SummaryCard, SummaryStat } from "~/features/common/ui/components/Summary";
import { Switch } from "~/features/common/ui/components/Switch";
import { useToast } from "~/features/common/ui/components/Toast";
import { deviceRawQuery, homeQuery } from "~/features/home/api";
import { GroupInput } from "~/features/home/components/GroupInput";
import { useHomeChange } from "~/features/home/hooks";
import type { HomeDevice, HomeOverview } from "~/features/home/types";
import { groupNames, kindIcon, nowLine, suggestedGroup } from "~/features/home/utils";
import { OptionList, OptionRow, SettingsSection } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

/** What the integration last sent for a device, to check how its properties are read. */
function Properties({ device }: { device: HomeDevice }) {
  const { data, isPending, error } = useQuery(deviceRawQuery(device.id));
  const toast = useToast();
  const text = data ? JSON.stringify(data.properties, null, 2) : "";
  return (
    <div className="flex flex-col gap-2">
      {isPending && <HelpText>Loading…</HelpText>}
      {error && <HelpText tone="bad">{errorMessage(error)}</HelpText>}
      {data && (
        <>
          <HelpText>
            {data.ts ? `As read at ${hhmm(data.ts)}.` : "Not read since the dashboard started."} Share these when a
            device reads wrongly, so its properties can be mapped.
          </HelpText>
          <pre className="m-0 max-h-[420px] overflow-auto rounded-2xl bg-canvas/60 p-4 font-mono text-xs leading-5 text-ink-soft light:bg-canvas">
            {text}
          </pre>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => void navigator.clipboard?.writeText(text).then(() => toast("Copied."))}
          >
            Copy
          </Button>
        </>
      )}
    </div>
  );
}

/** Its name, what it is, its group, whether it's in the breakdown, and (an appliance that doesn't report its power)
 * estimating it while it runs: each saved as it's changed. */
function Settings({
  device,
  kinds,
  groups,
}: {
  device: HomeDevice;
  kinds: HomeOverview["kinds"];
  groups: Map<string, number>;
}) {
  const { update } = useHomeChange();
  const [name, setName] = useState(device.name);
  const save = () => name.trim() && name.trim() !== device.name && update.mutate({ id: device.id, name: name.trim() });
  const e = device.estimate;
  const runs = (n: number) => `${n} ${n === 1 ? "run" : "runs"}`;
  return (
    <SettingsSection
      id="h-device-settings"
      title="Settings"
      sub="Saved as you change them. A smart plug can be set as the appliance it powers, so its runs are recorded; plugs in the same room can share a group, and the Home page shows them as one."
    >
      <OptionList>
        <OptionRow label="Name" help="What it's called across the dashboard.">
          <Input
            aria-label="Name"
            value={name}
            maxLength={60}
            onChange={(ev) => setName(ev.target.value)}
            onBlur={save}
            onKeyDown={(ev) => ev.key === "Enter" && (ev.currentTarget.blur(), save())}
            boxClassName="h-9 w-[240px] max-sm:w-full"
          />
        </OptionRow>
        <OptionRow label="What it is" help="An appliance that runs in cycles has its runs recorded.">
          <Select
            aria-label="What it is"
            className="w-[240px] max-sm:w-full"
            value={device.kind}
            disabled={update.isPending}
            onChange={(ev) => update.mutate({ id: device.id, kind: ev.target.value })}
          >
            {kinds.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </Select>
        </OptionRow>
        <OptionRow label="Group" help="Shown with the others in it as one on the Home page, e.g. a room.">
          <GroupInput
            key={device.group ?? ""}
            className="w-[240px] max-sm:w-full"
            value={device.group}
            groups={groups}
            suggestion={suggestedGroup(device.name)}
            disabled={update.isPending}
            onChange={(group) => update.mutate({ id: device.id, group })}
          />
        </OptionRow>
        <OptionRow
          label="In the breakdown"
          help="Left out, it's off the Home page and its use counts as everything else."
        >
          <Switch
            on={!device.hidden}
            label="Show in the breakdown"
            disabled={update.isPending}
            onChange={(on) => update.mutate({ id: device.id, hidden: !on })}
          />
        </OptionRow>
        {e && (
          <OptionRow
            label="Estimate its power while it runs"
            help={
              e.w != null
                ? `It only says what a run used once it's finished. With this on, while it runs it shows what its runs usually draw: about ${kW(e.w)}, from its last ${runs(e.runs)}. That's only shown: what's counted is still what it reports at the end.`
                : `It only says what a run used once it's finished. Once ${runs(e.needs)} have finished with their energy (${e.runs} so far), this can show what its runs usually draw while it runs.`
            }
          >
            <Switch
              on={e.on}
              label="Estimate its power while it runs"
              disabled={update.isPending}
              onChange={(on) => update.mutate({ id: device.id, estimate: on })}
            />
          </OptionRow>
        )}
      </OptionList>
      {update.isError && <HelpText tone="bad">{errorMessage(update.error)}</HelpText>}
    </SettingsSection>
  );
}

/**
 * Manage → Integrations → Smart home → a brand → one device: what it's doing and what it is at the top, its settings,
 * and what it last sent.
 */
export function HomeDeviceSettings({ integrationId, deviceId }: { integrationId: string; deviceId: number }) {
  const { data, isPending, error } = useQuery(homeQuery);
  const [raw, setRaw] = useState(false);
  const integration = data?.integrations.find((i) => i.id === integrationId);
  const device = data?.devices.find((d) => d.id === deviceId && d.integration === integrationId);
  const back = (
    <BackLink to="/integrations/home/$integration" params={{ integration: integrationId }}>
      {integration?.name ?? "Smart home"}
    </BackLink>
  );
  if (!device || !data)
    return (
      <SubPageHeader
        back={back}
        id="h-device"
        title="Device"
        sub={isPending ? "Loading…" : error ? errorMessage(error) : "There's no such device."}
      />
    );
  const now = nowLine(device);
  const n = device.now;
  const kind = data.kinds.find((k) => k.id === device.kind);
  const run = device.last_run;
  const live = !!n && n.online && !n.stale;
  return (
    <>
      <SubPageHeader
        back={back}
        id="h-device"
        title={device.name}
        sub={[device.model, integration?.name && `Through ${integration.name}`].filter(Boolean).join(" · ")}
      />
      <SummaryCard
        icon={kindIcon(device.kind)}
        color={live ? COLOR.brand : COLOR.warn}
        label={device.name}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-4 text-[13px] text-ink-muted">
            <span className="min-w-0 flex-1">
              {n ? `Last read ${hhmm(n.at)}.` : "Not read yet."} Its use, runs and habits are on its Home page.
            </span>
            <ButtonLink to="/home/$device" params={{ device: String(device.id) }} variant="outline" size="sm">
              Open on Home
            </ButtonLink>
          </div>
        }
      >
        <SummaryStat
          label="Now"
          value={
            !n
              ? "—"
              : !live
                ? n.online
                  ? "Not read"
                  : "Offline"
                : n.power_w != null && n.power_w >= 2
                  ? kW(n.power_w)
                  : now.running
                    ? "Running"
                    : "Idle"
          }
          color={live ? undefined : COLOR.warn}
          sub={now.text}
        />
        <SummaryStat
          label="What it is"
          value={kind?.label ?? device.kind}
          sub={device.group ? `In ${device.group}` : "On its own"}
        />
        <SummaryStat
          label="Last run"
          value={run ? kWh(run.kwh) : "—"}
          sub={
            run
              ? `${longDate.format(new Date(run.start * 1000))}${run.program ? `, ${run.program}` : ""}`
              : kind?.cycles
                ? "None yet"
                : "Doesn't run in cycles"
          }
        />
        <SummaryStat label="Breakdown" value={device.hidden ? "Left out" : "Counted"} sub="On the Home page" />
      </SummaryCard>
      <Settings key={device.id} device={device} kinds={data.kinds} groups={groupNames(data.devices)} />
      <SettingsSection
        id="h-device-raw"
        title="What it sends"
        sub="Its last reading as the integration received it, for checking how it's read."
        aside={
          <Button variant="outline" size="sm" aria-pressed={raw} onClick={() => setRaw(!raw)}>
            {raw ? "Hide" : "Show"}
          </Button>
        }
      >
        {raw && <Properties device={device} />}
      </SettingsSection>
    </>
  );
}
