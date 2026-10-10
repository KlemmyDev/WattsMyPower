import { useNavigate } from "@tanstack/react-router";
import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { Icon } from "~/features/common/ui/components/Icon";
import { TeslaConnect } from "~/features/ev/components/TeslaConnect";

const CAN = [
  "Read its charge, its charging and where it is",
  "Start and stop charging",
  "Change the charging current and the charge limit",
];

/**
 * Connecting an EV to charge from spare solar: what it's for, what the dashboard will do with it, and how to connect
 * it. So far, a Tesla: over this server's Bluetooth, or through Tessie, with the same features either way.
 */
export function EvSetupPage() {
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Connect your EV" sub="So it charges from spare solar" />
      <section
        aria-labelledby="h-su"
        className="flex w-full max-w-[720px] flex-col gap-6 rounded-3xl border border-line-subtle bg-surface p-8 max-sm:p-5"
      >
        <div className="flex flex-col gap-2">
          <h2 id="h-su" className="font-sans text-[28px] leading-9 font-normal tracking-[-0.5px]">
            Charge your EV from spare solar
          </h2>
          <p className="m-0 text-[15px] leading-6 text-pretty text-ink-muted">
            The dashboard talks to the car over this server's Bluetooth, or through Tessie. Either way nothing on this
            server is opened up to the internet and your Tesla account's password is never seen here.
          </p>
        </div>
        <div className="flex flex-col rounded-xl border border-line-subtle">
          <div className="border-b border-line-subtle px-4 py-3.5 text-[13px] font-semibold">
            The dashboard will be able to
          </div>
          {CAN.map((p) => (
            <div
              key={p}
              className="flex items-center gap-3 border-b border-line-subtle px-4 py-3 text-sm text-ink-muted last:border-b-0"
            >
              <span className="text-brand">
                <Icon name="check" size={18} />
              </span>
              {p}
            </div>
          ))}
        </div>
        <p className="m-0 text-[13px] leading-5 text-ink-muted">
          It only reads the car until you choose how it charges on the EV page, and it leaves the car alone whenever you
          start, stop or change charging yourself, until it's next unplugged.
        </p>
        <div className="flex flex-col gap-3">
          <span className="text-[13px] font-semibold">Connect your Tesla</span>
          <TeslaConnect onConnected={() => void navigate({ to: "/ev" })} />
        </div>
        <p className="m-0 text-[13px] text-ink-faint">
          A Hyundai or Kia is connected in Integrations → Electric vehicles → Hyundai and Kia, and charged from spare
          solar the same way. More cars and chargers can be connected later.
        </p>
        <div className="flex items-center gap-3 border-t border-line-subtle pt-4">
          <ButtonLink to="/ev" variant="outline" size="md">
            Cancel
          </ButtonLink>
        </div>
      </section>
    </>
  );
}
