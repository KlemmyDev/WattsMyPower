import type { ReactNode } from "react";
import { buttonClass } from "~/features/common/ui/components/Button";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";

const SUNGROW_GUIDE =
  "https://service.sungrowpower.com.au/files/Web_Files/FAQ/TD_202004_iSolarCloud_Export%20the%20parameter%20report%20via%20iSolarCloud%20portal_V1.0.pdf";

/** What each imported column becomes, what to tick in iSolarCloud for it, and what it feeds. */
const POINTS: { name: string; tick: ReactNode; feeds: string }[] = [
  {
    name: "Solar",
    tick: (
      <>
        <b>PV power</b> (the plant's), or <b>Total DC power</b> for each inverter. Tick both inverters if the plant has
        two; they're added together.
      </>
    ),
    feeds: "Solar history, the forecast's calibration, solar performance",
  },
  { name: "Home use", tick: <b>Load power</b>, feeds: "Home use, costs and bills" },
  {
    name: "Grid",
    tick: (
      <>
        <b>Purchased power</b> and <b>Feed-in power</b>, or one <b>Grid</b> column (positive when buying, negative when
        feeding in)
      </>
    ),
    feeds: "Grid import and export, costs, bills, self-sufficiency",
  },
  {
    name: "Battery",
    tick: (
      <>
        <b>Battery charging power</b> and <b>Battery discharging power</b>, or one <b>Battery</b> column with a sign
        (which way it runs is worked out from the file)
      </>
    ),
    feeds: "Battery flows, cycles",
  },
  {
    name: "Battery level",
    tick: (
      <>
        <b>Battery level (SOC)</b>
      </>
    ),
    feeds: "The battery chart, battery health",
  },
];

function Steps({ title, badge, children }: { title: string; badge?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-line-subtle p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {badge && (
          <span className="rounded-full bg-good-subtle px-2 py-0.5 text-[11px] font-semibold text-good">{badge}</span>
        )}
      </div>
      <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-[22px] text-ink-muted marker:text-ink-faint">
        {children}
      </ol>
    </div>
  );
}

/** Manage → Integrations → Sungrow → Import: which iSolarCloud export holds the 5-minute data, and how to get it. */
export function ExportGuide() {
  return (
    <SettingsCard padded aria-labelledby="h-export-guide">
      <SettingsTitle
        id="h-export-guide"
        title="What to export from iSolarCloud"
        sub="History needs the plant's power curve: a reading every 5 minutes. iSolarCloud's Report page only has daily and monthly totals, which aren't enough."
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
        <Steps title="Many days at once: the Curve page" badge="Best for a lot of history">
          <li>Sign in to iSolarCloud in a web browser on a computer, and open your plant.</li>
          <li>
            Open <b className="text-ink">Curve</b> from the menu on the left.
          </li>
          <li>
            Under the plant, each inverter and the energy storage system, tick the points listed below. For example,
            Load power is under the plant, and battery level under the energy storage system.
          </li>
          <li>
            Set the step to <b className="text-ink">5 min</b> and pick the dates.
          </li>
          <li>
            Click the list icon at the top right of the chart, then <b className="text-ink">Export</b> to save it as an
            Excel file.
          </li>
          <li>If it only allows a short range, export a few weeks at a time. You can upload all the files together.</li>
          <li className="list-none">
            <a
              href={SUNGROW_GUIDE}
              target="_blank"
              rel="noreferrer"
              className={buttonClass("link", "md", "inline font-medium")}
            >
              Sungrow's own guide to the Curve export, with screenshots (PDF)
            </a>
          </li>
        </Steps>
        <Steps title="One day at a time: the plant's day chart">
          <li>In the iSolarCloud app or website, open your plant and that day's power chart.</li>
          <li>
            Use <b className="text-ink">Export</b> (or download) on the chart. The file has Time, PV, Load, and the grid
            and battery at 5-minute steps, which is everything needed. Some have a column each way (Purchased Energy and
            Feed-in, Battery Charge and Battery Discharge), others one signed Grid and Battery column: either works.
          </li>
          <li>Repeat for each day, then select all the files here at once.</li>
        </Steps>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">The points to include</span>
        <div className="overflow-hidden rounded-2xl border border-line-subtle">
          <div className="grid grid-cols-[120px_1fr_1fr] gap-4 border-b border-line-subtle bg-canvas px-5 py-2.5 text-xs font-semibold text-ink-muted max-sm:hidden">
            <span>In WattsMyPower</span>
            <span>Tick in iSolarCloud</span>
            <span>Used for</span>
          </div>
          {POINTS.map((p) => (
            <div
              key={p.name}
              className="grid grid-cols-[120px_1fr_1fr] gap-4 border-b border-line-subtle px-5 py-3 text-sm last:border-b-0 max-sm:grid-cols-1 max-sm:gap-1"
            >
              <span className="font-semibold">{p.name}</span>
              <span className="text-ink-muted [&_b]:font-semibold [&_b]:text-ink">{p.tick}</span>
              <span className="text-ink-muted max-sm:text-xs">{p.feeds}</span>
            </div>
          ))}
        </div>
      </div>

      <ul className="m-0 flex list-disc flex-col gap-1.5 rounded-xl bg-canvas py-4 pr-[18px] pl-9 text-sm leading-[22px] text-pretty text-ink-muted">
        <li>
          If one of solar, home use, grid or battery is missing, it's worked out from the other three (home use = solar
          + grid + battery). So an export without the battery points still gets the battery's share.
        </li>
        <li>
          Columns are recognised by name, in W or kW, from .xlsx or .csv files. Older .xls workbooks need saving as
          .xlsx first.
        </li>
        <li>
          Times are read as the plant's local time. Imports never replace what WattsMyPower recorded itself, and each
          import can be removed again.
        </li>
      </ul>
    </SettingsCard>
  );
}
