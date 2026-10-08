import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { Button, ButtonLink } from "~/features/common/ui/components/Button";
import { Icon } from "~/features/common/ui/components/Icon";
import { cn } from "~/features/common/ui/utils";

const STEPS = ["Sign in", "Vehicle", "Charger", "Rules"];
const PERMISSIONS = [
  "Read charging status and battery level",
  "Start and stop charging",
  "Change the charge current",
  "Check whether the car is at home",
];

export function TeslaSetupPage() {
  return (
    <>
      <PageHeader title="Connect Tesla" sub="Four steps, about two minutes" />
      <section
        aria-labelledby="h-su"
        className="glass flex w-full max-w-[720px] flex-col gap-7 rounded-3xl border border-line-subtle p-8 max-sm:p-5"
      >
        <Steps current={0} />
        <div className="flex flex-col gap-2">
          <h2 id="h-su" className="font-sans text-[32px] leading-10 font-normal tracking-[-0.5px]">
            Sign in to Tesla
          </h2>
          <p className="m-0 text-[15px] leading-6 text-ink-muted">
            You will sign in on Tesla's website. Your Tesla password is never seen or stored here.
          </p>
        </div>
        <div className="flex flex-col rounded-xl border border-line-subtle">
          <div className="border-b border-line-subtle px-4 py-3.5 text-[13px] font-semibold">
            WattsMyPower will be able to
          </div>
          {PERMISSIONS.map((p) => (
            <div
              key={p}
              className="flex items-center gap-3 border-b border-line-subtle px-4 py-3 text-sm text-ink-muted"
            >
              <span className="text-brand">
                <Icon name="check" size={18} />
              </span>
              {p}
            </div>
          ))}
          <div className="px-4 py-3 text-[13px] text-ink-faint">
            You can remove access at any time in Manage → Integrations.
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-xl bg-canvas px-4 py-3.5 text-[13px] leading-5 text-ink-muted">
          <span>
            <Icon name="car" size={22} />
          </span>
          <div>
            <b className="mb-0.5 block text-sm font-medium text-ink">Tesla sign-in is not set up on this server yet</b>
            Connecting needs a Tesla Fleet API developer app. Once one is registered for this dashboard, this button
            will take you to Tesla to sign in.
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-line-subtle pt-2">
          <ButtonLink to="/tesla" variant="outline" size="lg">
            Cancel
          </ButtonLink>
          <Button disabled>Sign in with Tesla</Button>
        </div>
      </section>
    </>
  );
}

function Steps({ current }: { current: number }) {
  return (
    <ol className="m-0 flex list-none items-center gap-2 p-0">
      {STEPS.map((label, k) => {
        const cur = k === current;
        return (
          <li key={label} aria-current={cur ? "step" : undefined} className="flex min-w-0 flex-1 items-center gap-2">
            <div
              className={cn(
                "flex size-7 flex-none items-center justify-center rounded-full border text-[13px] font-semibold",
                cur ? "border-ink bg-ink text-ink-inverse" : "border-line bg-surface text-ink-faint",
              )}
            >
              {k + 1}
            </div>
            <div
              className={cn(
                "truncate text-[13px] max-sm:hidden",
                cur ? "font-semibold text-ink" : "font-medium text-ink-muted",
              )}
            >
              {label}
            </div>
            <div className="h-px min-w-2 flex-1 bg-line" />
          </li>
        );
      })}
    </ol>
  );
}
