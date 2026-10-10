import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { carsQuery } from "~/features/car/api";
import { CarDetailsForm } from "~/features/car/components/CarDetailsForm";
import { useCarChange } from "~/features/car/hooks";
import { BODY, carName } from "~/features/car/utils";
import { lookOf } from "~/features/ev/utils/looks";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText } from "~/features/common/ui/components/Field";
import { Notice } from "~/features/common/ui/components/Notice";
import { useToast } from "~/features/common/ui/components/Toast";
import { teslaQuery } from "~/features/ev/api";
import { SettingsSection } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

/**
 * Manage → Integrations → Electric vehicles → Tesla → a car's details: how it charges at home (what charging from
 * spare solar works with), what its range is worked out from, and how the Overview draws it; then removing it. Each
 * connected Tesla brings its own car; one added by hand before cars came only from a Tesla can be removed here.
 */
export function CarPage({ carId }: { carId: number }) {
  const { data: cars, error, isPending } = useQuery(carsQuery);
  const { data: tesla } = useQuery(teslaQuery);
  const view = cars?.find((c) => c.id === carId);
  const vehicle = tesla?.vehicles.find((v) => v.car === carId);
  const { remove } = useCarChange();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const back = <BackLink to="/integrations/ev/tesla">Tesla</BackLink>;
  if (!view)
    return (
      <>
        <SubPageHeader back={back} id="h-car" title="Car" sub={isPending ? "Loading…" : "There's no such car."} />
        {error && <Notice>{errorMessage(error)}</Notice>}
      </>
    );
  const c = view.car;
  // Tied to a Tesla whose model has a shape of its own: the Overview draws it as that, whatever's chosen here.
  const look = vehicle && lookOf(vehicle.make, vehicle.model);
  const drawnAs = vehicle && look?.known ? BODY[look.body] : undefined;
  return (
    <>
      <SubPageHeader
        back={back}
        id="h-car"
        title={carName(view)}
        sub="How it charges at home, what its range is worked out from, and how the Overview draws it."
      />
      <SettingsSection
        id="h-car-details"
        title="Details"
        sub={
          vehicle
            ? `The details ${vehicle.name ?? "this Tesla"} charges from spare solar with.`
            : "Added by hand, and not tied to a Tesla. The Overview still draws it."
        }
      >
        <CarDetailsForm key={view.id} id={view.id} car={c} drawnAs={drawnAs} />
      </SettingsSection>
      <SettingsSection
        id="h-car-remove"
        title="Remove this car"
        sub={
          vehicle
            ? `Its recorded levels go with it. The Tesla carries on with ${vehicle.model ?? "its model's"} figures.`
            : "Its recorded levels go with it."
        }
        aside={
          confirming ? (
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                disabled={remove.isPending}
                onClick={() =>
                  remove.mutate(view.id, {
                    onSuccess: () => {
                      toast(`${carName(view)} removed.`);
                      void navigate({ to: "/integrations/ev/tesla" });
                    },
                  })
                }
              >
                {remove.isPending ? "Removing…" : "Remove it"}
              </Button>
              <Button variant="muted-link" size="sm" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
              Remove
            </Button>
          )
        }
      >
        {remove.isError && <HelpText tone="bad">{errorMessage(remove.error)}</HelpText>}
      </SettingsSection>
    </>
  );
}
