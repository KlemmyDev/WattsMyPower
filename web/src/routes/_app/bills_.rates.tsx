import { createFileRoute, useLocation } from "@tanstack/react-router";
import { useEffect } from "react";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { BillsRatesSettings } from "~/features/settings/components/BillsRatesSettings";
import { BackLink } from "~/features/settings/components/SubPageHeader";

export const Route = createFileRoute("/_app/bills_/rates")({
  head: () => ({ meta: [{ title: "Rates & settings · Bills · WattsMyPower" }] }),
  component: BillsSettingsPage,
});

/**
 * Bills → Rates & settings: the rates, the billing period, and discounts and the budget (see BillsRatesSettings). Old
 * links to its parts (#rates, #period, #discounts) still land on them.
 */
function BillsSettingsPage() {
  useHoldAnchor(useLocation({ select: (l) => l.hash }));
  return (
    <>
      {/* Back to the bills (below xl, the row of pills over the page has the way back). */}
      <div className="pt-2 max-xl:hidden">
        <BackLink to="/bills">Bills</BackLink>
      </div>
      <PageHeader title="Rates & settings" sub="Everything your bills are worked out from" />
      <BillsRatesSettings />
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
