import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { MeterComparison } from "~/features/meter/components/MeterComparison";
import { MeterDataSettings } from "~/features/meter/components/MeterDataSettings";
import { BillAdjustments } from "~/features/settings/components/BillAdjustments";
import { BillingSettings } from "~/features/settings/components/BillingSettings";
import { RatesSummary } from "~/features/settings/components/RatesSummary";
import { BackLink } from "~/features/settings/components/SubPageHeader";
import { TariffSettings } from "~/features/settings/components/TariffSettings";

export const Route = createFileRoute("/_app/bills_/rates")({
  head: () => ({ meta: [{ title: "Rates & settings · Bills · WattsMyPower" }] }),
  component: BillsSettingsPage,
});

/** The page's parts, in order: the hash each is linked by, and its name in the row of links at the top. */
const SECTIONS = [
  { id: "rates", label: "Rates" },
  { id: "period", label: "Billing period" },
  { id: "discounts", label: "Discounts and budget" },
  { id: "meter", label: "Smart meter data" },
] as const;

export type BillsSection = (typeof SECTIONS)[number]["id"];

/**
 * Bills → Rates & settings: everything a bill is worked out from. The rates (Amber, a published plan, or entered by hand),
 * then when bills come, what comes off them and the budget, then the smart meter's data and how it compares.
 */
function BillsSettingsPage() {
  const s = useSystem();
  useHoldAnchor(useLocation({ select: (l) => l.hash }));
  return (
    <>
      {/* Back to the bills (below xl, the row of pills over the page has the way back). */}
      <div className="pt-2 max-xl:hidden">
        <BackLink to="/bills">Bills</BackLink>
      </div>
      <PageHeader title="Rates & settings" sub="Everything your bills are worked out from" />
      <RatesSummary />
      <nav aria-label="On this page" className="flex flex-wrap gap-2">
        {SECTIONS.map((x) => (
          <Link
            key={x.id}
            to="/bills/rates"
            hash={x.id}
            className="rounded-full border border-chip-line bg-chip px-3.5 py-1.5 text-[13px] font-medium text-ink-muted no-underline transition-colors hover:text-ink"
          >
            {x.label}
          </Link>
        ))}
      </nav>
      <Section id="rates" title="Rates" sub="What you pay for grid power and the supply charge, and earn for feed-in">
        <TariffSettings />
      </Section>
      <Section
        id="period"
        title="Your bill"
        sub="When bills come, what comes off them, and what you'd like them to stay under"
      >
        <BillingSettings />
        <div id="discounts" className="scroll-mt-6">
          {s && <BillAdjustments system={s} />}
        </div>
      </Section>
      <Section
        id="meter"
        title="Your meter"
        sub="Your retailer bills from the meter, so its readings are the most accurate grid figures"
      >
        <MeterDataSettings />
        <MeterComparison />
      </Section>
    </>
  );
}

/**
 * Keeps the section a link points to in view while the page settles: the rates above the later sections load
 * after the jump and push them down. Lets go after a few seconds, or as soon as you scroll yourself.
 */
function useHoldAnchor(hash: string) {
  useEffect(() => {
    const target = hash ? document.getElementById(hash) : null;
    if (!target) return;
    // Where scrolling to it puts it (under the header, or less near the end of the page): realigned when it moves.
    let at: number | null = null;
    const align = () => {
      if (at !== null && Math.abs(target.getBoundingClientRect().top - at) <= 2) return;
      target.scrollIntoView({ block: "start" });
      at = target.getBoundingClientRect().top;
    };
    const every = setInterval(align, 100);
    const stop = () => {
      clearInterval(every);
      clearTimeout(timer);
      for (const e of ["wheel", "touchstart", "pointerdown", "keydown"]) window.removeEventListener(e, stop);
    };
    const timer = setTimeout(stop, 3000);
    for (const e of ["wheel", "touchstart", "pointerdown", "keydown"])
      window.addEventListener(e, stop, { passive: true });
    return stop;
  }, [hash]);
}

/** A part of the page: a quiet heading over its cards, as the navigation's groups have. */
function Section({ id, title, sub, children }: { id: BillsSection; title: string; sub: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`h-sec-${id}`} id={id} className="flex scroll-mt-6 flex-col gap-4 pt-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-1">
        <h2
          id={`h-sec-${id}`}
          className="text-[13px] leading-5 font-semibold tracking-[0.08em] text-ink-muted uppercase"
        >
          {title}
        </h2>
        <span className="text-[13px] text-ink-faint">{sub}</span>
      </div>
      {children}
    </section>
  );
}
