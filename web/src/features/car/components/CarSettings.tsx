import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { carModelsQuery, carQuery } from "~/features/car/api";
import { CarDetailsForm } from "~/features/car/components/CarDetailsForm";
import type { CarDetails, CarModel, CarView } from "~/features/car/types";
import { carName, phaseWord } from "~/features/car/utils";
import { errorMessage } from "~/features/common/api/utils";
import { useSaveSettings } from "~/features/common/settings/hooks";
import { Button, ButtonLink } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input, Select } from "~/features/common/ui/components/Field";
import { Icon } from "~/features/common/ui/components/Icon";
import { Notice } from "~/features/common/ui/components/Notice";
import { useToast } from "~/features/common/ui/components/Toast";
import { cn } from "~/features/common/ui/utils";
import { IntegrationRow } from "~/features/settings/components/IntegrationRow";
import { SettingsCard, SettingsTitle } from "~/features/settings/components/SettingsCard";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

const OTHER = "other";

/** A model's figures in a line: "75 kWh · 160 Wh/km · 11 kW three-phase". */
const modelLine = (m: CarModel) =>
  `${m.battery_kwh} kWh · ${m.wh_per_km} Wh/km · ${m.ac_kw} kW ${phaseWord(m.phases)}${m.lfp ? " · LFP" : ""}`;

/** The car's details with a model's figures in place of the ones it sets. */
const withModel = (car: CarDetails, m: CarModel | null): CarDetails =>
  m
    ? {
        ...car,
        car_battery_kwh: m.battery_kwh,
        car_wh_per_km: m.wh_per_km,
        car_amps: m.max_amps,
        car_min_amps: m.min_amps,
        car_phases: m.phases,
        car_target_soc: m.target_soc,
      }
    : car;

/** Choose the car (or enter its details), name it, check the details, and connect. */
function ConnectCar({ view, onCancel }: { view: CarView; onCancel?: () => void }) {
  const { data: models } = useQuery(carModelsQuery);
  const toast = useToast();
  const makes = [...new Set((models ?? []).map((m) => m.make))];
  const [make, setMake] = useState(view.model?.make ?? "");
  const [modelId, setModelId] = useState(view.model?.id ?? "");
  const [name, setName] = useState(view.name ?? "");
  const choices = (models ?? []).filter((m) => m.make === make);
  const model = models?.find((m) => m.id === modelId) ?? null;
  const ready = make === OTHER || !!model;

  return (
    <SettingsCard padded aria-labelledby="h-car-connect">
      <SettingsTitle
        id="h-car-connect"
        title="Your car"
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
          {model?.lfp && (
            <Notice tone="info">
              The {model.model} has an LFP battery, which its maker says to charge to 100% regularly, so suggested
              charges go to 100%.
            </Notice>
          )}
          <CarDetailsForm
            key={modelId || make}
            car={withModel(view.car, model)}
            extra={{ car_connected: 1, car_name: name.trim() || null, car_model: model?.id ?? null }}
            submitLabel={view.connected ? "Save this car" : "Connect car"}
            onSaved={() => {
              toast(view.connected ? "Car saved." : `${name.trim() || model?.model || "Your car"} connected.`);
              onCancel?.();
            }}
            footer={
              onCancel && (
                <Button variant="muted-link" size="sm" onClick={onCancel}>
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

/** A connected car: what it is, a way to change or disconnect it, and its details. */
function ConnectedCar({ view }: { view: CarView }) {
  const save = useSaveSettings();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [changing, setChanging] = useState(false);
  const c = view.car;
  if (changing) return <ConnectCar view={view} onCancel={() => setChanging(false)} />;
  return (
    <>
      <SettingsCard aria-label="Connected car">
        <IntegrationRow
          icon="car"
          name={carName(view)}
          on
          status="Connected"
          detail={[
            view.name && view.model?.model,
            `${c.car_battery_kwh} kWh`,
            `${c.car_wh_per_km} Wh/km`,
            `charges at up to ${c.car_amps} A ${phaseWord(c.car_phases)}`,
          ]
            .filter(Boolean)
            .join(" · ")}
          action={
            confirming ? (
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={save.isPending}
                  onClick={() =>
                    save.mutate(
                      { car_connected: 0 },
                      {
                        onSuccess: () => {
                          setConfirming(false);
                          toast("Car disconnected.");
                        },
                      },
                    )
                  }
                >
                  {save.isPending ? "Disconnecting…" : "Disconnect"}
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
          {(confirming || save.isError) && (
            <div className="basis-full pl-[60px] max-sm:pl-0">
              <HelpText tone={save.isError ? "bad" : undefined}>
                {save.isError
                  ? errorMessage(save.error)
                  : "Charge suggestions stop, and the car leaves the Overview. Its details and planned charges are kept."}
              </HelpText>
            </div>
          )}
        </IntegrationRow>
      </SettingsCard>
      <SettingsCard padded aria-labelledby="h-car-details">
        <SettingsTitle
          id="h-car-details"
          title="Details"
          sub="What charge suggestions and the car's range are worked out from."
        />
        <CarDetailsForm car={c} />
      </SettingsCard>
    </>
  );
}

/** Settings → Integrations → Electric vehicle: connect a car, so charges are suggested for it, and its details. */
export function CarSettings() {
  const { data: view, error } = useQuery(carQuery);
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/settings/integrations">Integrations</BackLink>}
        id="h-car"
        title="Electric vehicle"
        sub="Tell the dashboard about your car, and Plan suggests when to charge it: from spare solar where it can, and at the cheapest times where it can't."
      />
      {error && <Notice>{errorMessage(error)}</Notice>}
      {view && (view.connected ? <ConnectedCar view={view} /> : <ConnectCar view={view} />)}
      <Notice tone="plain" className="flex items-start gap-3">
        <span className="mt-0.5 text-ink">
          <Icon name="plug" size={18} />
        </span>
        <span>
          <b className="mb-0.5 block font-medium text-ink">You start and stop the charging, for now</b>
          The dashboard suggests a start time and a current; set them in the car's app or on the charger. Controlling a
          Tesla or BYD directly, so charging follows the sun by itself, is coming.{" "}
          {view?.connected && (
            <ButtonLink to="/plan" hash="car" variant="link" size="sm">
              See suggested charges
            </ButtonLink>
          )}
        </span>
      </Notice>
    </>
  );
}
