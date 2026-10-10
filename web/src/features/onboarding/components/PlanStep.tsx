import { useReducer, useRef, useState } from "react";
import { AmberConnect } from "~/features/amber/components/AmberSettings";
import { COLOR } from "~/features/common/theme/utils/colors";
import { HelpText } from "~/features/common/ui/components/Field";
import { StepBody, StepFooter, StepIntro, type StepProps } from "~/features/onboarding/components/StepParts";
import { PlanSearch } from "~/features/settings/components/PlanFinder";
import { RatesDayChart } from "~/features/settings/components/RatesDayChart";
import { ChoiceTiles } from "~/features/settings/components/SettingsSection";
import { RatesFields, RatesLoading, useRatesDraft, useSaveRates } from "~/features/settings/components/TariffEditor";
import type { PlanTariff } from "~/features/settings/types";
import { EDITOR_START, editorReducer } from "~/features/settings/utils";

const SAVE = "Save and continue";

type Way = "find" | "manual" | "amber";

const WAYS = [
  { value: "find" as const, title: "Find my plan", sub: "By postcode and retailer", icon: "globe" as const },
  { value: "manual" as const, title: "Type the rates in", sub: "From your latest bill", icon: "tag" as const },
  { value: "amber" as const, title: "I'm with Amber", sub: "Prices every 5 minutes", icon: "pulse" as const },
];

/**
 * Step 3: the electricity plan, from Energy Made Easy, typed in, or Amber's live prices: three tiles to choose the
 * way, then the rates themselves beside a chart of them through the day, redrawn as a plan's loaded or a rate's
 * typed. The rates only appear once a plan is loaded (or asked for), and the step's own button saves them.
 */
export function PlanStep({ nav }: StepProps) {
  const [editor, dispatch] = useReducer(editorReducer, EDITOR_START);
  const { query, draft, dirty } = useRatesDraft(editor);
  const save = useSaveRates(dispatch);
  const [way, setWay] = useState<Way>("find");
  const [amberReady, setAmberReady] = useState(false);
  const ratesRef = useRef<HTMLDivElement>(null);
  // Rates saved before (going back to this step) are shown to check.
  const showRates = way === "manual" || amberReady || dirty || !!query.data?.source;
  const toRates = () =>
    requestAnimationFrame(() => ratesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));

  const importPlan = (plan: PlanTariff) => {
    dispatch({ type: "import", plan });
    toRates();
  };

  // Amber connected: show the rates, switched to Amber's prices (saved with the step's button).
  const switchToAmber = () => {
    if (draft && draft.type !== "amber")
      dispatch({ type: "edit", base: draft, edit: { type: "set-rate-type", value: "amber" } });
    setAmberReady(true);
    toRates();
  };

  return (
    <>
      <StepIntro nav={nav} title="Your electricity plan">
        So costs and savings match your bill. Find your plan, type in the rates from your bill, or connect Amber.
      </StepIntro>
      <StepBody>
        <ChoiceTiles
          label="How to add your plan"
          options={WAYS}
          value={way}
          onChange={setWay}
          color={COLOR.good}
          min="11rem"
          phone={1}
        />
        <div key={way} className="flex animate-rise flex-col gap-4 rounded-2xl bg-canvas/60 p-5 light:bg-canvas">
          {way === "find" && <PlanSearch onImport={importPlan} />}
          {way === "manual" && (
            <p className="m-0 text-[13px] leading-5 text-pretty text-ink-muted">
              The rates are below. Your bill lists what you pay for each kWh (at each time, if your rates change through
              the day), what you're paid for feed-in, and the daily supply charge.
            </p>
          )}
          {way === "amber" && <AmberConnect onReady={switchToAmber} />}
        </div>
      </StepBody>
      {showRates && (
        <div ref={ratesRef} className="scroll-mt-6 border-t border-line-subtle pt-6">
          <StepBody>
            <div className="@container">
              <div className="grid grid-cols-1 items-start gap-5 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="flex min-w-0 flex-col gap-3 rounded-2xl bg-canvas/60 p-5 @4xl:sticky @4xl:top-6 light:bg-canvas">
                  <span className="text-[15px] font-semibold">Your rates through the day</span>
                  {draft ? <RatesDayChart tariff={draft} /> : <RatesLoading failed={query.isError} />}
                </div>
                <div className="flex min-w-0 flex-col gap-6">
                  <h3 className="text-[15px] font-semibold">Your rates</h3>
                  {draft ? (
                    <RatesFields draft={draft} state={editor} dispatch={dispatch} saveLabel={SAVE} />
                  ) : (
                    <RatesLoading failed={query.isError} />
                  )}
                  {editor.status?.bad && <HelpText tone="bad">{editor.status.text}</HelpText>}
                </div>
              </div>
            </div>
          </StepBody>
        </div>
      )}
      <StepFooter
        nav={nav}
        label={dirty ? SAVE : undefined}
        disabled={save.isPending}
        onClick={dirty && draft ? () => save.save(draft, nav.done) : nav.done}
      />
    </>
  );
}
