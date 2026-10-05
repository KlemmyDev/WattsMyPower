import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { errorMessage } from "~/features/common/api/utils";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { addDays, midnight } from "~/features/common/time/utils";
import { useNow } from "~/features/common/time/hooks";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { homePatternsQuery, homeQuery, homeUsageQuery } from "~/features/home/api";
import { DeviceCard } from "~/features/home/components/DeviceCard";
import { UsageCard, type Range } from "~/features/home/components/UsageCard";
import { deviceColors } from "~/features/home/utils";

const RANGE_WORDS: Record<Range, string> = { today: "today", week: "in 7 days", month: "in 30 days" };

/** The period a range covers: today by the hour, or the last 7 or 30 days (today included) by the day. */
function period(range: Range, now: number): [start: number, end: number, bucket: "hour" | "day"] {
  const today = midnight(now);
  if (range === "today") return [today, addDays(today, 1), "hour"];
  return [addDays(today, range === "week" ? -6 : -29), addDays(today, 1), "day"];
}

/** Until something's connected: what the page will show, and where to connect it. */
function ConnectPrompt() {
  return (
    <Card aria-labelledby="h-connect" className="col-span-12 flex-row flex-wrap items-center gap-5">
      <span className="flex size-12 flex-none items-center justify-center rounded-full bg-canvas text-ink">
        <Icon name="washer" size={24} />
      </span>
      <div className="flex min-w-[240px] flex-1 flex-col gap-1">
        <h2 id="h-connect">See what each appliance uses</h2>
        <span className="text-sm text-pretty text-ink-muted">
          Connect smart appliances (a Hisense washer or dryer in the ConnectLife app) and each one's share of your
          home's use shows here, with when it usually runs.
        </span>
      </div>
      <ButtonLink to="/settings/integrations" hash="smart-home" variant="primary">
        Connect an appliance
      </ButtonLink>
    </Card>
  );
}

/**
 * Home: where the home's power goes. Everything the home used, split between the devices connected (smart
 * appliances, plugs) and everything else; then each device with what it's doing, what it used, and its habits.
 */
export function HomePage({ range }: { range: Range }) {
  const navigate = useNavigate();
  const now = useNow(60_000);
  const [start, end, bucket] = period(range, now);
  const overview = useQuery(homeQuery);
  const usage = useQuery(homeUsageQuery(start, end, bucket));
  const patterns = useQuery(homePatternsQuery);
  const devices = overview.data?.devices ?? [];
  const colors = deviceColors(devices);
  const visible = devices.filter((d) => !d.hidden);
  for (const d of devices) if (d.hidden) colors.delete(d.id);
  const kinds = new Map((overview.data?.kinds ?? []).map((k) => [k.id, k]));
  const running = visible.filter((d) => d.now?.running && !d.now.stale);
  const problems = (overview.data?.integrations ?? []).filter((i) => i.account?.error);

  return (
    <>
      <PageHeader
        title="Home"
        sub={
          running.length
            ? `${running.map((d) => d.name).join(" and ")} ${running.length === 1 ? "is" : "are"} running now`
            : "Where your home's power goes"
        }
      />
      {overview.error && <Notice>{errorMessage(overview.error)}</Notice>}
      {problems.map((i) => (
        <Notice key={i.id} tone="warn" className="flex flex-wrap items-center justify-between gap-3">
          <span>
            {i.name}: {i.account!.error}
          </span>
          <ButtonLink
            to="/settings/integrations/home/$integration"
            params={{ integration: i.id }}
            size="sm"
            variant="outline"
          >
            {i.account!.signed_out ? "Sign in again" : "Check it"}
          </ButtonLink>
        </Notice>
      ))}
      <div className="grid grid-cols-12 gap-5">
        <UsageCard
          usage={usage.data}
          colors={colors}
          range={range}
          onRange={(r) =>
            void navigate({ to: "/home", search: { range: r === "week" ? undefined : r }, replace: true })
          }
        />
        {overview.data && !devices.length && <ConnectPrompt />}
        {visible.map((d) => (
          <DeviceCard
            key={d.id}
            device={d}
            used={usage.data?.devices.find((u) => u.id === d.id)}
            pattern={patterns.data?.find((p) => p.id === d.id)}
            cycles={!!kinds.get(d.kind)?.cycles}
            kindLabel={kinds.get(d.kind)?.label ?? "Device"}
            color={colors.get(d.id)!}
            home={usage.data?.total.home ?? null}
            rangeLabel={RANGE_WORDS[range]}
          />
        ))}
      </div>
    </>
  );
}
