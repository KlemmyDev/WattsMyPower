import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { checkupQuery } from "~/features/health/api";
import type { Checkup as CheckupData, CheckStatus } from "~/features/health/types";
import { Card, Muted } from "~/features/common/ui/components/Card";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { hhmm } from "~/features/common/formatting/utils/date";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";

const TONE: Record<CheckStatus, { color: string; icon: IconName; label: string }> = {
  ok: { color: COLOR.good, icon: "check", label: "Good" },
  warn: { color: COLOR.warn, icon: "bell", label: "Worth a look" },
  bad: { color: COLOR.bad, icon: "bell", label: "Needs attention" },
  unknown: { color: COLOR.inkMuted, icon: "pulse", label: "Not enough to go on yet" },
};

function headline(c: CheckupData): string {
  const bad = c.items.filter((i) => i.status === "bad").length;
  const warn = c.items.filter((i) => i.status === "warn").length;
  if (bad) return bad === 1 ? "One thing needs attention" : `${bad} things need attention`;
  if (warn) return warn === 1 ? "One thing is worth a look" : `${warn} things are worth a look`;
  return "Everything is working as it should";
}

/** Where a line's detail is: a card on this page, or the page or settings that cover it. */
function Detail({ id, anchor }: { id: string; anchor: string }) {
  const cls = "text-[13px] font-medium text-link whitespace-nowrap";
  if (id === "inverter" || id === "pv2")
    return (
      <Link to="/settings/integrations/sungrow" className={cls}>
        Inverter settings
      </Link>
    );
  if (id === "forecast")
    return (
      <Link to="/plan" className={cls}>
        Plan
      </Link>
    );
  return (
    <a href={`#${anchor}`} className={cls}>
      Details
    </a>
  );
}

/** Each part of the system green, amber or red, with why, judged the same way as the alerts. */
export function Checkup() {
  const { data: c, isError } = useQuery(checkupQuery);
  return (
    <Card aria-labelledby="h-check">
      {!c ? (
        <Muted>{isError ? "The checkup could not be loaded. Try again shortly." : "Checking your system"}</Muted>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                className="flex size-10 items-center justify-center rounded-full"
                style={{ background: alpha(TONE[c.status].color, 0.16), color: TONE[c.status].color }}
              >
                <Icon name={c.status === "ok" ? "check" : "bell"} size={20} />
              </span>
              <h2 id="h-check">{headline(c)}</h2>
            </div>
            <span className="text-xs text-ink-faint">Checked at {hhmm(c.checked_at)}</span>
          </div>
          <ul className="flex flex-col">
            {c.items.map((i) => {
              const tone = TONE[i.status];
              return (
                <li
                  key={i.id}
                  className="grid grid-cols-[12px_160px_minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-1 border-t border-line-subtle py-3.5 max-md:grid-cols-[12px_minmax(0,1fr)_auto]"
                >
                  <i
                    className="size-2.5 translate-y-px rounded-full"
                    style={{ background: tone.color }}
                    title={tone.label}
                    aria-label={tone.label}
                  />
                  <span className="text-sm font-medium text-ink">{i.name}</span>
                  <span className="text-sm text-pretty text-ink-muted max-md:col-span-2 max-md:col-start-2 max-md:row-start-2">
                    {i.summary}
                  </span>
                  <Detail id={i.id} anchor={i.anchor} />
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}
