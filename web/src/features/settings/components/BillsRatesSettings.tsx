import { useReducer } from "react";
import { AmberTariffRow } from "~/features/amber/components/AmberTariffRow";
import { useSystem } from "~/features/common/live/hooks/useSystem";
import { BillAdjustments } from "~/features/settings/components/BillAdjustments";
import { BillingSettings } from "~/features/settings/components/BillingSettings";
import { BillPeriodVisual } from "~/features/settings/components/BillPeriodVisual";
import { RatesDayChart } from "~/features/settings/components/RatesDayChart";
import { RatesOptions } from "~/features/settings/components/RatesOptions";
import { SettingsSection, SettingsSplit } from "~/features/settings/components/SettingsSection";
import { RatesLoading, useRatesDraft } from "~/features/settings/components/TariffEditor";
import { EDITOR_START, editorReducer } from "~/features/settings/utils";

/**
 * Bills → Rates & settings: everything a bill is worked out from. On the left the rates through a day (as they're being
 * edited) and where this bill is; on the right the rates, the billing period, and discounts and the budget.
 */
export function BillsRatesSettings() {
  const s = useSystem();
  const [editor, dispatch] = useReducer(editorReducer, EDITOR_START);
  const { query, draft, dirty } = useRatesDraft(editor);
  // Switch the rates to Amber's prices (not saved until Save rates).
  const switchToAmber = () => {
    const base = editor.draft ?? query.data;
    if (base) dispatch({ type: "edit", base, edit: { type: "set-rate-type", value: "amber" } });
    document.getElementById("rates")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const discard = () => {
    dispatch({ type: "discard" });
    void query.refetch();
  };

  return (
    <>
      <AmberTariffRow onUse={switchToAmber} />
      <SettingsSplit
        visual={
          <>
            <SettingsSection
              id="h-rates-day"
              title="Your rates through the day"
              sub={
                dirty
                  ? "As you've changed them, not saved yet."
                  : draft?.type === "amber"
                    ? "Amber's prices change every 5 or 30 minutes; these are the fallback rates."
                    : "What grid power costs at each time, and what feed-in earns."
              }
            >
              {draft ? <RatesDayChart tariff={draft} /> : <RatesLoading failed={query.isError} />}
            </SettingsSection>
            <SettingsSection id="h-bill-now" title="This billing period">
              <BillPeriodVisual />
            </SettingsSection>
          </>
        }
      >
        {draft ? (
          <RatesOptions draft={draft} state={editor} dispatch={dispatch} dirty={dirty} onDiscard={discard} />
        ) : (
          <SettingsSection id="rates" title="Rates">
            <RatesLoading failed={query.isError} />
          </SettingsSection>
        )}
        <BillingSettings />
        {s && <BillAdjustments system={s} />}
      </SettingsSplit>
    </>
  );
}
