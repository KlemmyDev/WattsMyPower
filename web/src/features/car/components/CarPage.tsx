import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { carsQuery } from "~/features/car/api";
import { CarDetailsForm } from "~/features/car/components/CarDetailsForm";
import { useCarChange } from "~/features/car/hooks";
import { BODY, carName, paintOf, phaseWord } from "~/features/car/utils";
import { errorMessage } from "~/features/common/api/utils";
import { COLOR } from "~/features/common/theme/utils/colors";
import { Button } from "~/features/common/ui/components/Button";
import { HelpText } from "~/features/common/ui/components/Field";
import { Notice } from "~/features/common/ui/components/Notice";
import { SummaryCard, SummaryStat } from "~/features/common/ui/components/Summary";
import { useToast } from "~/features/common/ui/components/Toast";
import { teslaQuery } from "~/features/ev/api";
import { SettingsSection } from "~/features/settings/components/SettingsSection";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

/**
 * Manage → Integrations → Tesla → a car's details: how it charges at home (what charging from spare solar works
 * with), what its range is worked out from, and how the Overview draws it. Each connected Tesla brings its own car; one
 * added by hand before cars came only from a Tesla can be removed here.
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
  const back = <BackLink to="/integrations/tesla">Tesla</BackLink>;
  if (!view)
    return (
      <>
        <SubPageHeader back={back} id="h-car" title="Car" sub={isPending ? "Loading…" : "There's no such car."} />
        {error && <Notice>{errorMessage(error)}</Notice>}
      </>
    );
  const c = view.car;
  return (
    <>
      <SubPageHeader
        back={back}
        id="h-car"
        title={carName(view)}
        sub="How it charges at home, what its range is worked out from, and how the Overview draws it."
      />
      <SummaryCard
        icon="car"
        color={COLOR.lilac}
        label={carName(view)}
        footer={
          <div className="flex flex-col gap-3 border-t border-line-subtle pt-4 text-[13px] text-ink-muted">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="min-w-0 flex-1">
                {vehicle
                  ? `The details ${vehicle.name ?? "this Tesla"} charges from spare solar with.`
                  : "Added by hand, and not tied to a Tesla. The Overview still draws it."}
              </span>
              {confirming ? (
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate(view.id, {
                        onSuccess: () => {
                          toast(`${carName(view)} removed.`);
                          void navigate({ to: "/integrations/tesla" });
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
              )}
            </div>
            {(confirming || remove.isError) && (
              <HelpText tone={remove.isError ? "bad" : undefined}>
                {remove.isError
                  ? errorMessage(remove.error)
                  : vehicle
                    ? "Its recorded levels go with it. The Tesla carries on with its model's figures."
                    : "Its recorded levels go with it."}
              </HelpText>
            )}
          </div>
        }
      >
        <SummaryStat
          label="Level"
          value={view.level ? `${Math.round(view.level.soc)}%` : "—"}
          sub={vehicle ? "Read from the car" : "Not read"}
        />
        <SummaryStat label="Battery" value={`${c.car_battery_kwh} kWh`} sub={view.model?.model ?? "Usable"} />
        <SummaryStat label="Charges at" value={`up to ${c.car_amps} A`} sub={phaseWord(c.car_phases)} />
        <SummaryStat label="Uses" value={`${c.car_wh_per_km} Wh/km`} sub="On the road" />
        <SummaryStat
          label="On the Overview"
          value={paintOf(c.car_colour).label}
          sub={`${BODY[c.car_body]}, ${c.car_park === "garage" ? "in the garage" : "outside"}`}
          dot={paintOf(c.car_colour).hex}
        />
      </SummaryCard>
      <SettingsSection
        id="h-car-details"
        title="Details"
        sub="How it charges at home, what its range is worked out from, and how the Overview draws it."
      >
        <CarDetailsForm key={view.id} id={view.id} car={c} />
      </SettingsSection>
    </>
  );
}
