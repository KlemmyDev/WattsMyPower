import { useReducer, useRef, useState } from "react";
import { AmberConnect } from "~/features/amber/components/AmberSettings";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText } from "~/features/common/ui/components/Field";
import { StepBody, StepFooter, StepIntro, type StepProps } from "~/features/onboarding/components/StepParts";
import { PlanSearch } from "~/features/settings/components/PlanFinder";
import { RatesFields, RatesLoading, useRatesDraft, useSaveRates } from "~/features/settings/components/TariffEditor";
import type { PlanTariff } from "~/features/settings/types";
import { EDITOR_START, editorReducer } from "~/features/settings/utils";

const SAVE = "Save and continue";

/**
 * Step 3: the electricity plan, from Energy Made Easy or typed in. The same search and rates form as
 * Manage → Bills & rates, but the rates only appear once a plan is loaded (or asked for), and the step's own
 * button saves them.
 */
export function PlanStep({ nav }: StepProps) {
  const [editor, dispatch] = useReducer(editorReducer, EDITOR_START);
  const { query, draft, dirty } = useRatesDraft(editor);
  const save = useSaveRates(dispatch);
  const [manual, setManual] = useState(false);
  const [amber, setAmber] = useState(false);
  const ratesRef = useRef<HTMLDivElement>(null);
  // Rates saved before (going back to this step) are shown to check.
  const showRates = manual || dirty || !!query.data?.source;

  const importPlan = (plan: PlanTariff) => {
    dispatch({ type: "import", plan });
    requestAnimationFrame(() => ratesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  // Amber connected: show the rates, switched to Amber's prices (saved with the step's button).
  const switchToAmber = () => {
    if (draft && draft.type !== "amber")
      dispatch({ type: "edit", base: draft, edit: { type: "set-rate-type", value: "amber" } });
    setManual(true);
    requestAnimationFrame(() => ratesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <>
      <StepIntro nav={nav} title="Your electricity plan">
        So costs and savings match your bill. Find your plan by postcode and retailer, or enter the rates from your
        bill.
      </StepIntro>
      <StepBody>
        <PlanSearch onImport={importPlan} />
        {!showRates && (
          <Button variant="link" className="self-start text-sm" onClick={() => setManual(true)}>
            Enter the rates yourself
          </Button>
        )}
        {amber ? (
          <div className="flex flex-col gap-3 border-t border-line-subtle pt-5">
            <h3 className="text-[15px] font-semibold">Amber Electric</h3>
            <AmberConnect onReady={switchToAmber} />
          </div>
        ) : (
          <Button variant="link" className="self-start text-sm" onClick={() => setAmber(true)}>
            With Amber Electric? Connect your account
          </Button>
        )}
      </StepBody>
      {showRates && (
        <div ref={ratesRef} className="scroll-mt-6 border-t border-line-subtle pt-6">
          <StepBody>
            <h3 className="text-[15px] font-semibold">Your rates</h3>
            {draft ? (
              <RatesFields draft={draft} state={editor} dispatch={dispatch} saveLabel={SAVE} />
            ) : (
              <RatesLoading failed={query.isError} />
            )}
            {editor.status?.bad && <HelpText tone="bad">{editor.status.text}</HelpText>}
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
