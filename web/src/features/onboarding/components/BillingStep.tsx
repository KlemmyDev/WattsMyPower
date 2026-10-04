import { StepBody, StepFooter, StepIntro, type StepProps } from "~/features/onboarding/components/StepParts";
import { BillingFields } from "~/features/settings/components/BillingSettings";

/** Step 5: the billing period, saved as it changes (the defaults are calendar quarters). */
export function BillingStep({ nav }: StepProps) {
  return (
    <>
      <StepIntro nav={nav} title="Your billing period">
        Match the dates on your electricity bill, so bill estimates line up with what your retailer charges.
      </StepIntro>
      <StepBody>
        <BillingFields />
      </StepBody>
      <StepFooter nav={nav} />
    </>
  );
}
