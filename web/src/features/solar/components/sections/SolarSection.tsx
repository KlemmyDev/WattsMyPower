import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Icon, type IconName } from "~/features/common/ui/components/Icon";
import { BackLink } from "~/features/settings/components/SubPageHeader";

export type SectionKey = "strings" | "performance" | "forecast" | "readings";

/** The Solar page's sections, each a page of its own that a card on the Solar page drills into. */
export const SECTIONS: {
  key: SectionKey;
  to: "/solar/strings" | "/solar/performance" | "/solar/forecast" | "/solar/readings";
  title: string;
  about: string;
  icon: IconName;
}[] = [
  {
    key: "strings",
    to: "/solar/strings",
    title: "Strings and inverters",
    about: "Each string's volts, amps and power through the day, and how each inverter's holding up",
    icon: "bolt",
  },
  {
    key: "performance",
    to: "/solar/performance",
    title: "Performance",
    about: "What your panels made against what the weather allowed, and what's holding them back",
    icon: "chart",
  },
  {
    key: "forecast",
    to: "/solar/forecast",
    title: "Forecast",
    about: "The days ahead, and how close the forecast gets as it learns your roof",
    icon: "cloudSun",
  },
  {
    key: "readings",
    to: "/solar/readings",
    title: "Readings",
    about: "Every five-minute reading, any day, ready to download",
    icon: "database",
  },
];

/**
 * A page a level down from Solar: the way back, the section's title and its live line, its cards, and the other
 * sections to hop across to.
 */
export function SolarSection({
  section,
  sub,
  action,
  children,
}: {
  section: SectionKey;
  sub: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  const me = SECTIONS.find((s) => s.key === section)!;
  return (
    <>
      {/* Below xl the row of Solar's pages under the top bar is the way back. */}
      <div className="pt-2 max-xl:hidden">
        <BackLink to="/solar">Solar</BackLink>
      </div>
      <PageHeader title={me.title} sub={sub} action={action} />
      <div className="flex flex-col gap-5">
        {children}
        <MoreSections current={section} />
      </div>
    </>
  );
}

/** The other sections, as a row of links at the foot of a section's page. */
function MoreSections({ current }: { current: SectionKey }) {
  return (
    <nav aria-labelledby="solar-more" className="mt-4 flex flex-col gap-3">
      <h2 id="solar-more">More about your solar</h2>
      <div className="grid grid-cols-3 gap-4 max-xl:grid-cols-1">
        {SECTIONS.filter((s) => s.key !== current).map((s) => (
          <Link
            key={s.key}
            to={s.to}
            className="glass group flex items-start gap-3 rounded-3xl border border-line-subtle p-5 text-ink no-underline transition-colors hover:border-line"
          >
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-xl"
              style={{ background: `color-mix(in srgb, ${COLOR.solar} 14%, transparent)`, color: COLOR.solar }}
            >
              <Icon name={s.icon} size={18} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-medium">{s.title}</span>
              <span className="text-[13px] leading-5 text-ink-muted">{s.about}</span>
            </span>
            <Icon
              name="chevR"
              size={16}
              className="mt-1 text-ink-faint transition-transform group-hover:translate-x-0.5"
            />
          </Link>
        ))}
      </div>
    </nav>
  );
}

/** A quiet link from a card on the Solar page into one of its sections. */
export function SectionLink({ to, children }: { to: SectionKey; children: ReactNode }) {
  const s = SECTIONS.find((x) => x.key === to)!;
  return (
    <Link
      to={s.to}
      className="inline-flex shrink-0 items-center gap-0.5 text-[13px] font-medium whitespace-nowrap text-ink-muted no-underline hover:text-ink"
    >
      {children}
      <Icon name="chevR" size={14} />
    </Link>
  );
}
