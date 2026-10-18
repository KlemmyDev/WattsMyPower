import { hhmm, shortDay } from "~/features/common/formatting/utils/date";
import { Muted } from "~/features/common/ui/components/Card";
import { Pill } from "~/features/common/ui/components/Pill";
import type { HistoryEntry } from "~/features/notifications/types";
import { SettingsSection } from "~/features/settings/components/SettingsSection";

const LABEL: Record<string, string> = { push: "Devices", ntfy: "ntfy", webhook: "Webhook" };
const EVENT: Record<HistoryEntry["event"], string> = {
  alert: "Sent",
  resolved: "All clear",
  held: "Held back",
  test: "Test",
};

function when(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.toDateString() === new Date().toDateString() ? "" : `${shortDay.format(d)}, `}${hhmm(ts)}`;
}

/** What was sent and how each place took it, newest first: so a notification that didn't arrive says why. */
export function HistoryCard({ history }: { history: HistoryEntry[] }) {
  return (
    <SettingsSection
      id="h-history"
      title="Recent notifications"
      sub="What was sent, and how each place took it. If something didn't arrive, it says why."
    >
      {history.length === 0 ? (
        <Muted>Nothing yet. Send a test above to see how it looks.</Muted>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line-subtle p-0">
          {history.map((h) => (
            <li key={h.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <Pill tone={h.event === "held" ? "neutral" : h.event === "resolved" ? "ok" : "brand"} size="sm">
                  {EVENT[h.event]}
                </Pill>
                <span className="text-xs text-ink-faint tabular-nums">{when(h.ts)}</span>
              </div>
              <span className="text-[14px] font-medium text-pretty">{h.title}</span>
              <span className="text-[13px] leading-5 text-ink-muted">{h.body}</span>
              <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                {Object.entries(h.results).map(([k, v]) => (
                  <span key={k} className={v === "ok" ? "text-good" : "text-ink-muted"}>
                    {k === "held" || k === "none" ? v : `${LABEL[k] ?? k}: ${v === "ok" ? "delivered" : v}`}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
