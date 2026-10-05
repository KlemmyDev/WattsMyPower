import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { errorMessage } from "~/features/common/api/utils";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { STORE_HOME_RANGE, store } from "~/features/common/storage/utils";
import { addDays, midnight } from "~/features/common/time/utils";
import { useNow } from "~/features/common/time/hooks";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Card } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { homeInsightsQuery, homePatternsQuery, homeQuery, homeUsageQuery } from "~/features/home/api";
import { DeviceCard, GroupCard } from "~/features/home/components/DeviceCard";
import { HabitsCard, StandbyCard } from "~/features/home/components/InsightCards";
import { UsageCard, type Range } from "~/features/home/components/UsageCard";
import { deviceColors, groupPattern, groupUsage, homeItems } from "~/features/home/utils";

const RANGE_WORDS: Record<Range, string> = { today: "today", week: "in 7 days", month: "in 30 days" };
/** The period before the one shown, of the same length, in words (today isn't compared: it isn't over). */
const BEFORE_WORDS: Record<Range, string> = { today: "", week: "the 7 days before", month: "the 30 days before" };

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
  // The period before, to compare each device with (by the day, for 7 or 30 days).
  const before = useQuery({ ...homeUsageQuery(2 * start - end, start, "day"), enabled: range !== "today" });
  const patterns = useQuery(homePatternsQuery);
  const found = useQuery(homeInsightsQuery);
  const devices = overview.data?.devices ?? [];
  const colors = deviceColors(devices);
  const visible = devices.filter((d) => !d.hidden);
  for (const d of devices) if (d.hidden) colors.delete(d.id);
  const kinds = new Map((overview.data?.kinds ?? []).map((k) => [k.id, k]));
  const kindLabels = new Map([...kinds].map(([id, k]) => [id, k.label]));
  // Grouped devices (the plugs in a room) are shown as one, in the breakdown and as a card.
  const items = homeItems(devices);
  const used = usage.data && groupUsage(usage.data, items);
  const earlier = before.data && range !== "today" ? groupUsage(before.data, items) : undefined;
  const beforeOf = (id: number) => (earlier ? (earlier.devices.find((u) => u.id === id)?.total ?? 0) : undefined);
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
          usage={used}
          colors={colors}
          range={range}
          rangeWords={RANGE_WORDS[range]}
          onRange={(r) => {
            store.set(STORE_HOME_RANGE, r); // opened again (or refreshed) later, it shows this period
            void navigate({ to: "/home", search: { range: r }, replace: true });
          }}
        />
        {overview.data && !devices.length && <ConnectPrompt />}
        {devices.length > 0 && (
          <>
            <StandbyCard standby={found.data?.standby} devices={devices} colors={colors} />
            <HabitsCard unexplained={found.data?.unexplained} />
          </>
        )}
        {items.map((item) =>
          item.group ? (
            <GroupCard
              key={`group:${item.group}`}
              name={item.group}
              members={item.members}
              used={used?.devices.find((u) => u.id === item.id)}
              before={beforeOf(item.id)}
              pattern={patterns.data && groupPattern(patterns.data, item)}
              cycles={item.members.every((d) => kinds.get(d.kind)?.cycles)}
              kindLabels={kindLabels}
              color={colors.get(item.id)!}
              home={usage.data?.total.home ?? null}
              rangeLabel={RANGE_WORDS[range]}
              beforeLabel={BEFORE_WORDS[range]}
            />
          ) : (
            <DeviceCard
              key={item.id}
              device={item.members[0]}
              used={used?.devices.find((u) => u.id === item.id)}
              before={beforeOf(item.id)}
              pattern={patterns.data?.find((p) => p.id === item.id)}
              cycles={!!kinds.get(item.members[0].kind)?.cycles}
              kindLabel={kindLabels.get(item.members[0].kind) ?? "Device"}
              color={colors.get(item.id)!}
              home={usage.data?.total.home ?? null}
              rangeLabel={RANGE_WORDS[range]}
              beforeLabel={BEFORE_WORDS[range]}
              best={found.data?.best_times.find((b) => b.id === item.id)}
            />
          ),
        )}
      </div>
    </>
  );
}
