import { useState, type FormEvent } from "react";
import { useGeocode } from "~/features/settings/hooks/useGeocode";
import { useSaveSettings } from "~/features/common/settings/hooks";
import type { Settings } from "~/features/common/settings/types";
import type { SystemInfo } from "~/features/common/live/types";
import { Button } from "~/features/common/ui/components/Button";
import { Field, HelpText, Input } from "~/features/common/ui/components/Field";
import { useToast } from "~/features/common/ui/components/Toast";
import { failure, saveSettingsError } from "~/features/common/settings/utils";
import { cn } from "~/features/common/ui/utils";

type LocationChanges = Pick<Partial<Settings>, "latitude" | "longitude" | "location_name">;

/**
 * Pick the forecast location by place search, or by typing coordinates. In Settings it's mounted while
 * open, with a Cancel button (`onClose`); the set-up guide shows it beside the place's daylight.
 */
export function LocationForm({
  system,
  onClose,
  onSaved = onClose,
  autoFocus = true,
  className,
}: {
  system: SystemInfo | undefined;
  onClose?: () => void;
  onSaved?: () => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const toast = useToast();
  const geocode = useGeocode();
  const saveSettings = useSaveSettings();
  const [place, setPlace] = useState("");
  const [error, setError] = useState("");
  const [coordsOpen, setCoordsOpen] = useState(false);
  const [lat, setLat] = useState(() => String(system?.latitude ?? ""));
  const [lon, setLon] = useState(() => String(system?.longitude ?? ""));

  // Search on submit only: OpenStreetMap asks apps not to search as you type.
  const search = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const q = place.trim();
    setError("");
    if (q.length < 3) {
      setError("Enter at least three letters of a suburb, town or address.");
      return;
    }
    geocode.mutate(q, { onError: (err) => setError(failure(err, "The search didn't work. Try again.")) });
  };

  const save = (changes: LocationChanges) => {
    if (Object.values(changes).some((v) => Number.isNaN(v))) {
      setError("Enter a number.");
      return;
    }
    saveSettings.mutate(changes, {
      onSuccess: () => {
        setError("");
        toast("Location saved. Updating the forecast.");
        onSaved?.();
      },
      onError: (err) => setError(saveSettingsError(err)),
    });
  };

  const places = geocode.data;
  return (
    <div className={cn("flex basis-full flex-col gap-2.5 pl-[60px] max-sm:pl-0", className)}>
      <form className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 max-[520px]:grid-cols-1" onSubmit={search}>
        <Field label="Suburb, town or address">
          <Input
            autoFocus={autoFocus}
            placeholder="For example, Paddington QLD"
            autoComplete="off"
            value={place}
            onChange={(e) => setPlace(e.target.value)}
          />
        </Field>
        <div className="flex gap-2">
          {onClose && (
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
          )}
          <Button type="submit" size="sm" disabled={geocode.isPending}>
            Search
          </Button>
        </div>
      </form>
      <div className="flex flex-col gap-1.5 empty:hidden">
        {geocode.isPending ? (
          <HelpText>Searching…</HelpText>
        ) : places && places.length ? (
          places.map((p, i) => (
            <button
              key={i}
              type="button"
              className="flex items-baseline justify-between gap-3 rounded-[10px] border border-line bg-surface px-3.5 py-3 text-left text-sm font-medium text-ink hover:border-line-strong hover:bg-surface-raised max-[520px]:flex-col max-[520px]:gap-0.5"
              onClick={() => save({ latitude: p.latitude, longitude: p.longitude, location_name: p.name })}
            >
              <span>{p.label}</span>
              <small className="text-xs font-normal whitespace-nowrap text-ink-faint">{p.detail}</small>
            </button>
          ))
        ) : (
          places && <HelpText>No places found. Try a suburb and state, for example Paddington QLD.</HelpText>
        )}
      </div>
      <HelpText tone="bad">{error}</HelpText>
      <HelpText>
        Searches OpenStreetMap. Only the suburb name and its coordinates are saved, never a street address.
        <Button variant="link" className="ml-1 text-xs" onClick={() => setCoordsOpen((o) => !o)}>
          Enter coordinates instead
        </Button>
      </HelpText>
      {coordsOpen && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))_auto] items-end gap-3">
          <Field label="Latitude">
            <Input
              autoFocus
              type="number"
              step="0.0001"
              min="-90"
              max="90"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
          </Field>
          <Field label="Longitude">
            <Input
              type="number"
              step="0.0001"
              min="-180"
              max="180"
              value={lon}
              onChange={(e) => setLon(e.target.value)}
            />
          </Field>
          <Button
            size="sm"
            onClick={() =>
              save({ latitude: lat.trim() === "" ? NaN : +lat, longitude: lon.trim() === "" ? NaN : +lon })
            }
          >
            Save coordinates
          </Button>
        </div>
      )}
    </div>
  );
}
