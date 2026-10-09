import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { carModelsQuery, carsQuery } from "~/features/car/api";
import { CarDetailsForm } from "~/features/car/components/CarDetailsForm";
import { useCarChange } from "~/features/car/hooks";
import type { CarDetails, CarModel, CarView } from "~/features/car/types";
import { BODY, carName, paintOf, phaseWord } from "~/features/car/utils";
import { errorMessage } from "~/features/common/api/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input, Select } from "~/features/common/ui/components/Field";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { useToast } from "~/features/common/ui/components/Toast";
import { cn } from "~/features/common/ui/utils";
import { IntegrationLink } from "~/features/integrations/components/IntegrationLink";
import { IntegrationRow } from "~/features/settings/components/IntegrationRow";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

const OTHER = "other";

/** A new car's details before any are chosen. */
const FRESH: CarDetails = {
  car_battery_kwh: 75,
  car_amps: 16,
  car_min_amps: 6,
  car_phases: 1,
  car_voltage: 230,
  car_wh_per_km: 170,
  car_colour: "white",
  car_body: "suv",
  car_park: "garage",
};

/** A model's figures in a line: "75 kWh · 160 Wh/km · 11 kW three-phase". */
const modelLine = (m: CarModel) =>
  `${m.battery_kwh} kWh · ${m.wh_per_km} Wh/km · ${m.ac_kw} kW ${phaseWord(m.phases)}${m.lfp ? " · LFP" : ""}`;

/** A car's details with a model's figures in place of the ones it sets. */
const withModel = (car: CarDetails, m: CarModel | null): CarDetails =>
  m
    ? {
        ...car,
        car_battery_kwh: m.battery_kwh,
        car_wh_per_km: m.wh_per_km,
        car_amps: m.max_amps,
        car_min_amps: m.min_amps,
        car_phases: m.phases,
        car_body: m.body,
      }
    : car;

/** A car in a line: its model, battery, use and how it charges. */
const carLine = (v: CarView) =>
  [
    v.name && v.model?.model,
    `${v.car.car_battery_kwh} kWh`,
    `${v.car.car_wh_per_km} Wh/km`,
    `up to ${v.car.car_amps} A ${phaseWord(v.car.car_phases)}`,
  ]
    .filter(Boolean)
    .join(" · ");

/**
 * Choose a car (or enter its details), name it, check the details, and connect it; or, given `view`, change which
 * car a connected one is.
 */
function ConnectCar({ view, onDone }: { view?: CarView; onDone?: (car: CarView) => void }) {
  const { data: models } = useQuery(carModelsQuery);
  const toast = useToast();
  const makes = [...new Set((models ?? []).map((m) => m.make))];
  const [make, setMake] = useState(view?.model?.make ?? "");
  const [modelId, setModelId] = useState(view?.model?.id ?? "");
  const [name, setName] = useState(view?.name ?? "");
  const choices = (models ?? []).filter((m) => m.make === make);
  const model = models?.find((m) => m.id === modelId) ?? null;
  const ready = make === OTHER || !!model;
  const base = view?.car ?? FRESH;

  return (
    <SettingsCard padded aria-labelledby="h-car-connect">
      <SettingsTitle
        id="h-car-connect"
        title={view ? "Change car" : "Connect a car"}
        sub="Choose it to fill in its details, or enter them yourself. You can change any of them after."
      />
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] items-start gap-4">
        <Field label="Make">
          <Select
            value={make}
            onChange={(e) => {
              setMake(e.target.value);
              setModelId("");
            }}
          >
            <option value="">Choose…</option>
            {makes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
            <option value={OTHER}>Another car: enter its details</option>
          </Select>
        </Field>
        <Field label="Name" help="Optional: what to call it here.">
          <Input
            value={name}
            maxLength={60}
            placeholder={model?.model ?? "e.g. The Model Y"}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
      </div>
      {choices.length > 0 && (
        <div
          role="radiogroup"
          aria-label="Model"
          className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2"
        >
          {choices.map((m) => {
            const on = m.id === modelId;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setModelId(m.id)}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-xl border px-4 py-3 text-left transition-colors",
                  on ? "border-ink bg-surface-inset" : "border-line-subtle bg-surface hover:border-line-strong",
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                  {m.model}
                  {on && <Icon name="check" size={16} className="text-good" />}
                </span>
                <span className="text-xs text-ink-muted tabular-nums">{modelLine(m)}</span>
              </button>
            );
          })}
        </div>
      )}
      {ready && (
        <div className="flex flex-col gap-5 border-t border-line-subtle pt-6">
          <CarDetailsForm
            key={modelId || make}
            car={withModel(base, model)}
            id={view?.id}
            identity={{ name: name.trim() || null, model: model?.id ?? null }}
            submitLabel={view ? "Save this car" : "Connect car"}
            onSaved={(car) => {
              toast(view ? "Car saved." : `${carName(car)} connected.`);
              onDone?.(car);
            }}
            footer={
              onDone &&
              view && (
                <Button variant="muted-link" size="sm" onClick={() => onDone(view)}>
                  Cancel
                </Button>
              )
            }
          />
        </div>
      )}
    </SettingsCard>
  );
}

/** Manage → Integrations → Electric vehicle: the cars connected, each opening to its own page, and adding one. */
export function CarSettings() {
  const { data: cars, error } = useQuery(carsQuery);
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const none = cars?.length === 0;
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/integrations">Integrations</BackLink>}
        id="h-car"
        title="Electric vehicles"
        sub="Tell the dashboard about your cars: how each charges at home, and how the Overview draws it."
      />
      {error && <Notice>{errorMessage(error)}</Notice>}
      {cars && cars.length > 0 && (
        <SettingsCard aria-label="Cars connected">
          {cars.map((v) => (
            <IntegrationLink
              key={v.id}
              to="/integrations/car/$carId"
              params={{ carId: String(v.id) }}
              icon="car"
              name={
                <span className="flex items-center gap-2">
                  <i
                    className="size-3 rounded-full border border-fg/20"
                    style={{ background: paintOf(v.car.car_colour).hex }}
                  />
                  {carName(v)}
                </span>
              }
              status={v.level ? `${Math.round(v.level.soc)}%` : "Connected"}
              on
              detail={carLine(v)}
            />
          ))}
        </SettingsCard>
      )}
      {cars && (none || adding) && (
        <ConnectCar
          onDone={(car) => {
            setAdding(false);
            void navigate({ to: "/integrations/car/$carId", params: { carId: String(car.id) } });
          }}
        />
      )}
      {cars && !none && !adding && (
        <Button variant="outline" size="sm" className="self-start" onClick={() => setAdding(true)}>
          <Icon name="plus" size={16} />
          Connect another car
        </Button>
      )}
      <ControlNote />
    </>
  );
}

function ControlNote() {
  return (
    <Notice tone="plain" className="flex items-start gap-3">
      <span className="mt-0.5 text-ink">
        <Icon name="plug" size={18} />
      </span>
      <span>
        <b className="mb-0.5 block font-medium text-ink">Charging from spare solar</b>A Tesla connected over Bluetooth
        or through Tessie (Integrations → Tesla) can charge from spare solar by itself, with its level read from the
        car. Other cars are charged as you set them in the car's app or on the charger.
      </span>
    </Notice>
  );
}

/** Manage → Integrations → Electric vehicle → a car: what it is, changing or disconnecting it, and its details. */
export function CarPage({ carId }: { carId: number }) {
  const { data: cars, error, isPending } = useQuery(carsQuery);
  const view = cars?.find((c) => c.id === carId);
  const { remove } = useCarChange();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [changing, setChanging] = useState(false);
  const back = <BackLink to="/integrations/car">Electric vehicles</BackLink>;
  if (!view)
    return (
      <>
        <SubPageHeader back={back} id="h-car" title="Car" sub={isPending ? "Loading…" : "This car isn't connected."} />
        {error && <Notice>{errorMessage(error)}</Notice>}
      </>
    );
  return (
    <>
      <SubPageHeader back={back} id="h-car" title={carName(view)} sub={carLine(view)} />
      {changing ? (
        <ConnectCar view={view} onDone={() => setChanging(false)} />
      ) : (
        <>
          <SettingsCard aria-label="The car">
            <IntegrationRow
              icon="car"
              name={carName(view)}
              on
              status="Connected"
              detail={`${BODY[view.car.car_body]} in ${paintOf(view.car.car_colour).label.toLowerCase()}, parks ${view.car.car_park === "garage" ? "in the garage" : "outside"}`}
              action={
                confirming ? (
                  <div className="flex items-center gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={remove.isPending}
                      onClick={() =>
                        remove.mutate(view.id, {
                          onSuccess: () => {
                            toast(`${carName(view)} disconnected.`);
                            void navigate({ to: "/integrations/car" });
                          },
                        })
                      }
                    >
                      {remove.isPending ? "Disconnecting…" : "Disconnect"}
                    </Button>
                    <Button variant="muted-link" size="sm" onClick={() => setConfirming(false)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => setChanging(true)}>
                      Change car
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
                      Disconnect
                    </Button>
                  </div>
                )
              }
            >
              {(confirming || remove.isError) && (
                <div className="basis-full pl-[60px] max-sm:pl-0">
                  <HelpText tone={remove.isError ? "bad" : undefined}>
                    {remove.isError ? errorMessage(remove.error) : "Its recorded levels go with it."}
                  </HelpText>
                </div>
              )}
            </IntegrationRow>
          </SettingsCard>
          <SettingsCard padded aria-labelledby="h-car-details">
            <SettingsTitle
              id="h-car-details"
              title="Details"
              sub="How it charges at home, what its range is worked out from, and how the Overview draws it."
            />
            <CarDetailsForm key={view.id} id={view.id} car={view.car} />
          </SettingsCard>
        </>
      )}
      <ControlNote />
    </>
  );
}
