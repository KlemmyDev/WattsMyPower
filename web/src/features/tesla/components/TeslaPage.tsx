import { PageHeader } from "~/features/common/layout/components/PageHeader";
import { ButtonLink } from "~/features/common/ui/components/Button";
import { EmptyState } from "~/features/common/ui/components/EmptyState";

export function TeslaPage() {
  return (
    <>
      <PageHeader title="Tesla" sub="Not connected" />
      <EmptyState
        icon="car"
        id="h-te"
        title="Charge your Tesla with excess solar"
        action={
          <ButtonLink to="/tesla/setup" variant="primary" size="lg">
            Connect Tesla
          </ButtonLink>
        }
      >
        Connect your Tesla account and the charge rate will adjust through the day, so the car gets spare solar and the
        home battery still fills.
      </EmptyState>
    </>
  );
}
