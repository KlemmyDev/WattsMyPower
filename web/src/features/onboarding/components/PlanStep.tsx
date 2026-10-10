import { useReducer, useState } from "react";
import { AmberConnect } from "~/features/amber/components/AmberSettings";
import { alpha, COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText } from "~/features/common/ui/components/Field";
import { Icon } from "~/features/common/ui/components/Icon";
import { StepBody, StepFooter, StepIntro, type StepProps } from "~/features/onboarding/components/StepParts";
import { RateRows } from "~/features/settings/components/RatesOptions";
import { RatesDayChart } from "~/features/settings/components/RatesDayChart";
import { RatesLoading, useRatesDraft, useSaveRates } from "~/features/settings/components/TariffEditor";
import { EDITOR_START, editorReducer } from "~/features/settings/utils";

const SAVE = "Save and continue";

/**
 * Step 3: the electricity plan, typed in from the bill: the same rates as Bills → Rates & settings, beside a chart of
 * them through the day that redraws as they're typed. Amber's customers can connect it instead. The step's own button
 * saves them.
 */
export function PlanStep({ nav }: StepProps) {
  const [editor, dispatch] = useReducer(editorReducer, EDITOR_START);
  const { query, draft, dirty } = useRatesDraft(editor);
  const save = useSaveRates(dispatch);
  const [amber, setAmber] = useState(false);

  // Amber connected: the rates switch to Amber's prices (saved with the step's button).
  const switchToAmber = () => {
    if (draft && draft.type !== "amber")
      dispatch({ type: "edit", base: draft, edit: { type: "set-rate-type", value: "amber" } });
    setAmber(false);
  };

  return (
    <>
      <StepIntro nav={nav} title="Your electricity plan">
        So costs and savings match your bill. Copy the rates from your latest bill: what you pay for grid power, what
        you earn for feed-in, and the daily supply charge.
      </StepIntro>
      <StepBody>
        <div className="@container">
          <div className="grid grid-cols-1 items-start gap-5 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-3 rounded-2xl bg-canvas/60 p-5 @4xl:sticky @4xl:top-6 light:bg-canvas">
              <span className="text-[15px] font-semibold">Your rates through the day</span>
              {draft ? <RatesDayChart tariff={draft} /> : <RatesLoading failed={query.isError} />}
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              {draft ? <RateRows draft={draft} dispatch={dispatch} /> : <RatesLoading failed={query.isError} />}
              {editor.status?.bad && <HelpText tone="bad">{editor.status.text}</HelpText>}
              <div className="flex flex-col gap-4 rounded-2xl bg-canvas/60 p-4 light:bg-canvas">
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className="flex size-8 flex-none items-center justify-center rounded-full"
                    style={{ background: alpha(COLOR.good, 0.16), color: COLOR.good }}
                  >
                    <Icon name="pulse" size={16} />
                  </span>
                  <span className="flex min-w-[160px] flex-1 flex-col gap-0.5">
                    <span className="text-[15px] font-semibold">With Amber Electric?</span>
                    <span className="text-[13px] text-ink-muted">Use its prices, updated every 5 minutes.</span>
                  </span>
                  <Button variant="outline" size="sm" aria-expanded={amber} onClick={() => setAmber((o) => !o)}>
                    {amber ? "Not now" : "Connect Amber"}
                  </Button>
                </div>
                {amber && <AmberConnect onReady={switchToAmber} />}
              </div>
            </div>
          </div>
        </div>
      </StepBody>
      <StepFooter
        nav={nav}
        label={dirty ? SAVE : undefined}
        disabled={save.isPending}
        onClick={dirty && draft ? () => save.save(draft, nav.done) : nav.done}
      />
    </>
  );
}
