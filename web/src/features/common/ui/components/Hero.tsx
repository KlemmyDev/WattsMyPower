import { Link } from "@tanstack/react-router";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { NAV } from "~/features/common/layout/utils";
import { alpha } from "~/features/common/theme/utils/colors";
import { Card } from "~/features/common/ui/components/Card";
import { Icon } from "~/features/common/ui/components/Icon";
import { Figure, LiveDot } from "~/features/common/ui/components/Live";
import { cn } from "~/features/common/ui/utils";
import { useWidgetFrame } from "~/features/common/widgets/frame";
import type { GroupId } from "~/features/common/widgets/types";

/*
 * A page's top card, the same on every page (Solar, Home, Battery, and the rest after them): what matters most today
 * as one big figure, what's happening now beside it, up to four figures that round it out, a bar that shows where the
 * day stands, and the page's main chart under them. Everything else on the page drills in from here. See
 * docs/design-language.md.
 *
 *   <HeroCard tint={COLOR.solar} label="Solar today and now">
 *     <HeroTop>
 *       <HeroFigures>
 *         <HeroLead label="Made today" value="18.4" unit="kWh" sub={…} />
 *         <HeroLive label="Generating now" on color={COLOR.solar} value="3.2" unit="kW" sub={…} />
 *       </HeroFigures>
 *       <HeroStats>
 *         <HeroStat label="Peak" value="4.1 kW" sub="at 12:10" />
 *       </HeroStats>
 *     </HeroTop>
 *     <HeroBar legend={…}>…</HeroBar>
 *     <TimeLine … />
 *   </HeroCard>
 */

/** Each widget group's page, for a hero shown on a dashboard to name and link to. */
const PAGE_OF: Partial<Record<GroupId, string>> = {
  solar: "/solar",
  home: "/home",
  battery: "/battery",
  grid: "/grid",
  car: "/ev",
  money: "/bills",
  weather: "/plan",
};

/**
 * The card, washed from the top in the page's colour (`tint`), `wash` strong. It lays itself out by its own width
 * (a container), so it fits a half-width widget as well as a page. On a dashboard it says which page it's from, with
 * a link there, above its figures.
 */
export function HeroCard({
  tint,
  wash = 0.1,
  label,
  className,
  style,
  children,
  ...rest
}: Omit<ComponentProps<typeof Card>, "aria-label"> & { tint: string; wash?: number; label: string }) {
  const frame = useWidgetFrame();
  const to = frame ? PAGE_OF[frame.group] : undefined;
  const page = to ? NAV.find((n) => n.to === to) : undefined;
  return (
    <Card
      aria-label={label}
      className={cn("@container h-full gap-6", className)}
      style={{ backgroundImage: `linear-gradient(180deg, ${alpha(tint, wash)}, transparent 45%)`, ...style }}
      {...rest}
    >
      {page && (
        <Link
          to={page.to}
          className="relative z-2 -mb-3 flex items-center gap-1.5 self-start text-[13px] font-medium text-ink-muted no-underline hover:text-ink"
        >
          <Icon name={page.icon} size={14} style={{ color: page.color }} />
          {page.label}
          <Icon name="chevR" size={12} className="text-ink-faint" />
        </Link>
      )}
      {children}
    </Card>
  );
}

/**
 * The top row: the figures on the left, the stats on the right, wrapping under them where there's no room. On a phone
 * it comes apart (contents) so the bar can sit right under the lead figure.
 */
export function HeroTop({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5 @max-xl:contents">{children}</div>;
}

/** The lead figure and the live one, side by side. */
export function HeroFigures({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-x-8 gap-y-5 @max-xl:contents">{children}</div>;
}

/** What matters most today, big: "Made today 18.4 kWh", with a line under it (where it's heading, a change chip). */
export function HeroLead({
  label,
  value,
  unit,
  sub,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 @max-xl:-order-2">
      <span className="text-[13px] text-ink-muted">{label}</span>
      <Figure value={value} unit={unit} size="xl" />
      {sub && <span className="flex flex-wrap items-center gap-2 text-[13px] text-ink-muted tabular-nums">{sub}</span>}
    </div>
  );
}

/** What's happening now, beside the lead figure: a live dot in `color` (breathing while `on`), the figure, a line. */
export function HeroLive({
  label,
  on,
  color,
  value,
  unit,
  sub,
}: {
  label: ReactNode;
  on: boolean;
  color: string;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 border-l border-line-subtle pl-6 @max-xl:border-l-0 @max-xl:pl-0">
      <span className="flex items-center gap-2 text-[13px] text-ink-muted">
        <LiveDot on={on} color={color} />
        {label}
      </span>
      <Figure value={value} unit={unit} />
      {sub && (
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted tabular-nums">{sub}</span>
      )}
    </div>
  );
}

/** Up to four figures that round the picture out, two across on narrower screens. */
export function HeroStats({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={cn("grid grid-cols-4 gap-x-8 gap-y-3 @max-2xl:grid-cols-2", className)}>{children}</dl>;
}

export function HeroStat({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-ink-faint">{label}</dt>
      <dd className="text-[20px] leading-6 font-light tracking-[-0.3px] whitespace-nowrap tabular-nums">{value}</dd>
      {sub && <dd className="truncate text-[11.5px] text-ink-faint">{sub}</dd>}
    </div>
  );
}

/**
 * Where the day stands, along one bar (the pace against what was expected, the battery's level): the track's contents
 * are the children (HeroFill, HeroTick, or anything absolutely placed), with a legend under it. Sits right under the
 * lead figure on a phone.
 */
export function HeroBar({
  children,
  legend,
  className,
}: {
  children: ReactNode;
  legend?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 @max-xl:-order-1", className)}>
      <div className="relative h-2.5 rounded-full bg-track">{children}</div>
      {legend && (
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-ink-faint tabular-nums">
          {legend}
        </div>
      )}
    </div>
  );
}

const at = (pc: number) => `${Math.max(0, Math.min(100, pc))}%`;

/** A stretch of the bar from `from`% to `to`%: solid, `dashed` (still to come), or faint (a likely range). */
export function HeroFill({
  to,
  from = 0,
  color,
  variant = "solid",
  style,
  className,
}: {
  to: number;
  from?: number;
  color: string;
  variant?: "solid" | "dashed" | "faint";
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "absolute inset-y-0 rounded-full",
        variant === "solid" && "transition-[width] duration-700 ease-out-soft",
        variant === "dashed" && "border border-dashed",
        className,
      )}
      style={{
        left: at(from),
        width: `calc(${at(to)} - ${at(from)})`,
        ...(variant === "solid"
          ? { background: color }
          : variant === "dashed"
            ? { borderColor: alpha(color, 0.7) }
            : { background: alpha(color, 0.18) }),
        ...style,
      }}
    />
  );
}

/** A tick across the bar at `at`% for what the day's measured against; ink unless `color` says otherwise. */
export function HeroTick({ at: pc, color, title }: { at: number; color?: string; title?: string }) {
  return (
    <span
      title={title}
      className={cn("absolute -inset-y-1.5 w-0.5 -translate-x-1/2 rounded-full", !color && "bg-ink")}
      style={{ left: at(pc), background: color }}
    />
  );
}

/** One entry in the bar's legend, its mark matching the bar: a dot (a fill), a tick, or a dashed ring (to come). */
export function HeroKey({
  mark,
  color,
  children,
}: {
  mark: "dot" | "tick" | "dashed";
  color?: string;
  children: ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5">
      {mark === "dot" ? (
        <i className="size-2 rounded-full" style={{ background: color }} />
      ) : mark === "tick" ? (
        <i className={cn("h-2.5 w-0.5 rounded-full", !color && "bg-ink")} style={{ background: color }} />
      ) : (
        <i className="size-2 rounded-full border border-dashed" style={{ borderColor: color }} />
      )}
      {children}
    </span>
  );
}
