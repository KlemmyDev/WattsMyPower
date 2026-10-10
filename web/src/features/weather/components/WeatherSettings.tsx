import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorMessage } from "~/features/common/api/utils";
import { locationLabel } from "~/features/common/energy/utils";
import { hhmm, longDate, parseYmd, shortDay } from "~/features/common/formatting/utils/date";
import { intAU, kWh, plural } from "~/features/common/formatting/utils/number";
import { useLive } from "~/features/common/live/hooks/useLive";
import { useLocationSet, useSaveSettings } from "~/features/common/settings/hooks";
import type { Settings, WeatherModel } from "~/features/common/settings/types";
import { saveSettingsError } from "~/features/common/settings/utils";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input, Select } from "~/features/common/ui/components/Field";
import { Notice } from "~/features/common/ui/components/Notice";
import { Pill } from "~/features/common/ui/components/Pill";
import { Segmented } from "~/features/common/ui/components/Segmented";
import { Switch } from "~/features/common/ui/components/Switch";
import { useToast } from "~/features/common/ui/components/Toast";
import { retrain, weatherStatusQuery } from "~/features/weather/api";
import type { WeatherStatus } from "~/features/weather/types";
import { useFetchWeather, WeatherFetchProgress } from "~/features/weather/components/WeatherFetch";
import { LocationForm } from "~/features/settings/components/LocationForm";
import { CardTitle, SettingsCard } from "~/features/settings/components/SettingsCard";
import { BackLink, SubPageHeader } from "~/features/settings/components/SubPageHeader";

const MODELS: { value: WeatherModel; label: string; help: string }[] = [
  {
    value: "best_match",
    label: "Open-Meteo's pick (recommended)",
    help: "Open-Meteo blends the best models for your location.",
  },
  { value: "ecmwf_ifs025", label: "ECMWF", help: "The European centre's global model." },
  { value: "gfs_seamless", label: "GFS", help: "The US weather service's global model." },
  { value: "icon_seamless", label: "ICON", help: "Germany's weather service's global model." },
];

const DIRECTIONS = [
  ["North", 0],
  ["North-east", 45],
  ["East", 90],
  ["South-east", 135],
  ["South", 180],
  ["South-west", 225],
  ["West", 270],
  ["North-west", 315],
] as const;

/** Save a setting straight away, with a toast to say so. */
function useSaveNow() {
  const save = useSaveSettings();
  const toast = useToast();
  return {
    ...save,
    now: (changes: Partial<Settings>, said: string) =>
      save.mutate(changes, { onSuccess: () => toast(said), onError: (e) => toast(saveSettingsError(e)) }),
  };
}

/** Where the forecast is for, and changing it. */
export function WeatherLocation() {
  const system = useLive()?.system;
  const located = useLocationSet();
  return (
    <SettingsCard padded aria-labelledby="h-location" className="gap-4">
      <CardTitle
        id="h-location"
        title="Location"
        sub={
          located === false ? (
            "No location is set yet, so there's no forecast, and no power outages or warnings near you. Search for your suburb to set it."
          ) : (
            <>
              The forecast is for <b className="font-semibold text-ink">{locationLabel(system)}</b>. Search for a suburb
              to change it.
            </>
          )
        }
      />
      {/* Started afresh once the location is known, and again when it's changed. */}
      <LocationForm
        key={`${system?.latitude},${system?.longitude}`}
        system={system}
        autoFocus={false}
        className="pl-0"
      />
    </SettingsCard>
  );
}

/** °C or °F, for every temperature the dashboard shows. */
function Units() {
  const system = useLive()?.system;
  const save = useSaveNow();
  const fahrenheit = save.isPending ? !!save.variables?.temp_unit_f : !!system?.temp_unit_f;
  return (
    <SettingsCard padded aria-labelledby="h-units" className="gap-4">
      <CardTitle
        id="h-units"
        title="Temperature"
        sub="How temperatures show across the dashboard, on every device."
        aside={
          <Segmented
            label="Temperature unit"
            options={[
              { value: "c", label: "°C" },
              { value: "f", label: "°F" },
            ]}
            value={fahrenheit ? "f" : "c"}
            onChange={(v) =>
              save.now({ temp_unit_f: v === "f" ? 1 : 0 }, `Temperatures now show in ${v === "f" ? "°F" : "°C"}.`)
            }
          />
        }
      />
    </SettingsCard>
  );
}

/** Which of Open-Meteo's weather models the forecast uses. */
function Model({ status }: { status: WeatherStatus | undefined }) {
  const system = useLive()?.system;
  const save = useSaveNow();
  const value = (save.isPending ? save.variables?.weather_model : system?.weather_model) ?? "best_match";
  const chosen = MODELS.find((m) => m.value === value) ?? MODELS[0];
  return (
    <SettingsCard padded aria-labelledby="h-model" className="gap-4">
      <CardTitle
        id="h-model"
        title="Weather model"
        sub="Where the forecast's sunshine, cloud, rain and temperature come from. Past weather is filled in from the same model."
      />
      <Field label="Model" help={chosen.help} className="max-w-[420px]">
        <Select
          value={value}
          onChange={(e) =>
            save.now({ weather_model: e.target.value as WeatherModel }, "Saved. The forecast will update in a moment.")
          }
        >
          {MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </Field>
      {status?.model_unavailable && status.model_unavailable === value && (
        <Notice tone="warn">
          {chosen.label} doesn't cover your location fully, so Open-Meteo's pick is being used instead.
        </Notice>
      )}
    </SettingsCard>
  );
}

/** How the panels sit, so sunlight can be worked out on them rather than on flat ground. */
function Panels() {
  const system = useLive()?.system;
  const save = useSaveSettings();
  const toast = useToast();
  const [tilt, setTilt] = useState(() => String(system?.panel_tilt ?? 0));
  const [bearing, setBearing] = useState(() => String(system?.panel_bearing ?? 0));
  const [error, setError] = useState("");
  const preset = DIRECTIONS.some(([, b]) => String(b) === bearing);
  const changed = system && (+tilt !== system.panel_tilt || +bearing !== system.panel_bearing);

  const submit = () => {
    const t = Number(tilt);
    if (tilt.trim() === "" || !(t >= 0 && t <= 90)) return setError("Enter a tilt from 0 to 90 degrees.");
    setError("");
    save.mutate(
      { panel_tilt: t, panel_bearing: Number(bearing) },
      {
        onSuccess: () => toast("Saved. The forecast's learning starts again for the new angle."),
        onError: (e) => setError(saveSettingsError(e)),
      },
    );
  };

  return (
    <SettingsCard padded aria-labelledby="h-panels" className="gap-4">
      <CardTitle
        id="h-panels"
        title="Your panels"
        sub="How steep the panels are and which way they face. It's optional: the forecast learns your roof from its history either way, and this gives it a head start. Leave the tilt at 0 if you're not sure."
      />
      <div className="grid grid-cols-[minmax(0,200px)_minmax(0,240px)_auto] items-start justify-start gap-3 max-sm:grid-cols-1">
        <Field label="Tilt" help="Degrees from flat. Most Australian roofs are 20 to 25.">
          <Input type="number" min="0" max="90" step="1" value={tilt} onChange={(e) => setTilt(e.target.value)} />
        </Field>
        <Field label="Facing" help={`Compass bearing ${bearing}°`}>
          <Select value={bearing} onChange={(e) => setBearing(e.target.value)} disabled={+tilt === 0}>
            {DIRECTIONS.map(([name, b]) => (
              <option key={b} value={String(b)}>
                {name}
              </option>
            ))}
            {!preset && <option value={bearing}>{bearing}°</option>}
          </Select>
        </Field>
        <Button
          size="sm"
          className="mt-[26px] w-fit max-sm:mt-0"
          onClick={submit}
          disabled={!changed || save.isPending}
        >
          Save
        </Button>
      </div>
      <HelpText tone="bad">{error}</HelpText>
    </SettingsCard>
  );
}

/** What's stored, and filling in the weather for days with readings but none. */
function History({ status }: { status: WeatherStatus | undefined }) {
  const fetchWeather = useFetchWeather();
  // Report how a fill went only for one started here, not one from long ago.
  const [startedAt, setStartedAt] = useState<number | null>(null);
  if (!status) return null;
  const { stored, backfill } = status;
  const days = Math.round(stored.hours / 24);
  const remaining = backfill.remaining;
  const start = (refetch: boolean) =>
    fetchWeather.mutate(refetch, { onSuccess: (r) => setStartedAt(r.backfill.started_at ?? 0) });
  return (
    <SettingsCard padded aria-labelledby="h-history" className="gap-4">
      <CardTitle
        id="h-history"
        title="Weather history"
        sub={`Each hour's weather is kept, so History can show what it was like on any day and the forecast can learn from it. It's filled in for every day with readings, including imported ones, as far back as they go (Open-Meteo's archive starts in ${status.archive_from.slice(0, 4)}).`}
      />
      <div className="flex flex-col gap-1 text-sm">
        <span>
          {stored.first_ts
            ? `${intAU(days)} ${plural(days, "day")} stored, from ${longDate.format(new Date(stored.first_ts * 1000))}.`
            : "Nothing stored yet."}
        </span>
        {!backfill.running && (
          <span className="text-ink-muted">
            {remaining
              ? `${intAU(remaining)} ${plural(remaining, "day")} with readings ${remaining === 1 ? "has" : "have"} no weather yet. They're filled in a few months each half hour, or all at once now.`
              : "Every day with readings has its weather."}
          </span>
        )}
      </div>
      {!status.location_set && (
        <Notice tone="warn">Choose your location above first, so the weather is fetched for the right place.</Notice>
      )}
      <WeatherFetchProgress since={startedAt ?? Infinity} />
      {!backfill.running && status.location_set && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {remaining > 0 && (
            <Button variant="outline" size="sm" onClick={() => start(false)} disabled={fetchWeather.isPending}>
              Fetch the missing weather
            </Button>
          )}
          {days > 0 && (
            <Button variant="link" size="sm" onClick={() => start(true)} disabled={fetchWeather.isPending}>
              Fetch it all again
            </Button>
          )}
        </div>
      )}
      {!backfill.running && days > 0 && (
        <HelpText>
          Fetching it all again replaces the filled-in history, say after changing the weather model. Hours the forecast
          recorded as they happened are kept.
        </HelpText>
      )}
      {fetchWeather.isError && <HelpText tone="bad">{errorMessage(fetchWeather.error)}</HelpText>}
    </SettingsCard>
  );
}

/** The learned model: whether it's on and in use, how it back-tested, and the day-ahead forecast's record. */
function Learning({ status }: { status: WeatherStatus | undefined }) {
  const qc = useQueryClient();
  const toast = useToast();
  const save = useSaveNow();
  const train = useMutation({
    mutationFn: retrain,
    onSuccess: () => {
      toast("Retrained.");
      qc.invalidateQueries({ queryKey: ["weather"] });
      qc.invalidateQueries({ queryKey: ["forecast"] });
    },
  });
  if (!status) return null;
  const { learning, accuracy } = status;
  const on = save.isPending ? !!save.variables?.forecast_learning : learning.on;
  const b = learning.backtest;
  const tested = b && b.days > 0 && b.learned_mae != null && b.simple_mae != null;
  const recent = accuracy.days.slice(-7).reverse();

  const state = !on
    ? "Off: the forecast uses the plain model, fitted on the last week."
    : learning.in_use
      ? `In use, learned from ${intAU(learning.days)} ${plural(learning.days, "day")} of weather and solar.`
      : !tested
        ? "Not in use yet. It needs a few weeks of days with both readings and weather to learn from and test on."
        : b.days < learning.min_days
          ? `Not in use yet: it's been tested on ${b.days} ${plural(b.days, "day")} so far, and needs ${learning.min_days}.`
          : "Not in use: the plain forecast has been closer so far. It's tested again every day.";

  return (
    <SettingsCard padded aria-labelledby="h-learning" className="gap-5">
      <CardTitle
        id="h-learning"
        title="Learn from history"
        sub="The forecast learns how your roof turns sunshine into solar, including its direction, shade at different times of year, heat and the inverter's limit. It's only used once a test on recent days shows it's more accurate than the plain forecast."
        aside={
          <Switch
            on={on}
            onChange={(v) =>
              save.now({ forecast_learning: v ? 1 : 0 }, v ? "Learning switched on." : "Learning switched off.")
            }
            disabled={save.isPending}
            label="Learn from history"
          />
        }
      />
      <div className="flex flex-col gap-1.5 text-sm">
        <span className="flex flex-wrap items-center gap-2">
          {learning.in_use && on && (
            <Pill tone="ok" size="sm">
              In use
            </Pill>
          )}
          {state}
        </span>
        {tested && (
          <span className="text-ink-muted">
            Tested on the last {b.days} {plural(b.days, "day")}: out by {kWh(b.learned_mae)} a day on average, against{" "}
            {kWh(b.simple_mae)} for the plain forecast
            {b.actual_mean ? `, on days averaging ${kWh(b.actual_mean)}` : ""}.
          </span>
        )}
        {learning.trained_at && (
          <span className="text-xs text-ink-faint">
            Last trained {longDate.format(new Date(learning.trained_at * 1000))} at {hhmm(learning.trained_at)}.
            <Button variant="link" className="ml-1 text-xs" onClick={() => train.mutate()} disabled={train.isPending}>
              {train.isPending ? "Retraining…" : "Retrain now"}
            </Button>
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold">The day-ahead forecast</span>
        {accuracy.mae_kwh == null ? (
          <HelpText>
            Each day's forecast is kept as it stood the day before, to measure it against what the panels made. The
            first comparison shows after a full day.
          </HelpText>
        ) : (
          <>
            <span className="text-sm text-ink-muted">
              Over the last {accuracy.days.length} {plural(accuracy.days.length, "day")} it was out by{" "}
              {kWh(accuracy.mae_kwh)} a day on average
              {accuracy.bias_kwh != null && Math.abs(accuracy.bias_kwh) >= 0.1
                ? `, and ${accuracy.bias_kwh > 0 ? "over" : "under"}-forecast by ${kWh(Math.abs(accuracy.bias_kwh))} a day overall`
                : ""}
              .
            </span>
            <div className="overflow-hidden rounded-2xl border border-line-subtle">
              <table className="w-full border-collapse text-sm tabular-nums">
                <thead className="bg-canvas text-xs text-ink-muted">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold">Day</th>
                    <th className="px-3 py-2 text-right font-semibold">Forecast</th>
                    <th className="px-3 py-2 text-right font-semibold">Made</th>
                    <th className="px-4 py-2 text-right font-semibold">Out by</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((d) => (
                    <tr key={d.date} className="border-t border-line-subtle">
                      <td className="px-4 py-2">{shortDay.format(parseYmd(d.date))}</td>
                      <td className="px-3 py-2 text-right">{kWh(d.forecast_kwh)}</td>
                      <td className="px-3 py-2 text-right">{kWh(d.actual_kwh)}</td>
                      <td className="px-4 py-2 text-right text-ink-muted">
                        {kWh(Math.abs(d.forecast_kwh - d.actual_kwh))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
      {train.isError && <HelpText tone="bad">{errorMessage(train.error)}</HelpText>}
    </SettingsCard>
  );
}

/** Manage → Integrations → Weather: the Open-Meteo forecast behind the solar forecast, and what it learns. */
export function WeatherSettings() {
  const system = useLive()?.system;
  const { data: status } = useQuery(weatherStatusQuery);
  const updated = status?.fetched_at ? `Updated ${hhmm(status.fetched_at)}` : null;
  return (
    <>
      <SubPageHeader
        back={<BackLink to="/integrations">Integrations</BackLink>}
        id="h-weather"
        title="Weather"
        sub={
          <>
            Open-Meteo's hourly forecast for {locationLabel(system)}: sunshine, cloud, rain and temperature, for the
            solar forecast.{updated && ` ${updated}.`}
          </>
        }
      />
      {status?.error && <Notice>{status.error}. The last forecast stored is shown meanwhile.</Notice>}
      <WeatherLocation />
      <Units />
      <Model status={status} />
      {/* Started afresh once the saved angle is known, and after it's saved. */}
      <Panels key={system ? `${system.panel_tilt},${system.panel_bearing}` : ""} />
      <History status={status} />
      <Learning status={status} />
    </>
  );
}
