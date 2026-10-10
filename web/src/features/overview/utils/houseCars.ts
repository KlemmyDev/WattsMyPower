import type { CarView } from "~/features/car/types";
import { carName, PAINT, paintOf } from "~/features/car/utils";
import type { EvBrief } from "~/features/ev/types";
import { carTitle } from "~/features/ev/utils";
import { lookOf } from "~/features/ev/utils/looks";
import type { SceneCar } from "~/features/overview/components/HouseScene";
import type { Park } from "~/features/overview/utils/house/layout";

/** A car for the house, and where it would rather park. */
export type HouseCar = SceneCar & { park: Park };

/**
 * The cars parked at the house: each EV connected through an integration, drawn as what it is (its make and model's
 * shape; its dashboard car's paint, else the paint the car gives, else its model's usual), labelled with its name, level
 * and whether it's charging or away, and linking to its page in Integrations. Then any car added by hand before cars
 * came from an integration, not tied to one, as it was set up, so nobody's car goes missing.
 *
 * An EV not tied to a dashboard car (charging with its model's figures) takes the paint and parking of an untied
 * dashboard car of its make, if there is one: most likely the one made for it, so it isn't drawn twice.
 */
export function houseCars(evs: EvBrief[] | null | undefined, cars: CarView[] | undefined): HouseCar[] {
  const records = cars ?? [];
  const tied = new Set((evs ?? []).map((v) => v.car));
  const spare = records.filter((c) => !tied.has(c.id));
  const sameMake = (c: CarView, make: string) => c.model?.make.toLowerCase() === make.toLowerCase();
  const connected = (evs ?? []).map((v): HouseCar => {
    const own = v.car != null ? records.find((c) => c.id === v.car) : undefined;
    const borrowed = own ? undefined : spare.find((c) => sameMake(c, v.make));
    if (borrowed) spare.splice(spare.indexOf(borrowed), 1);
    const record = own ?? borrowed;
    const look = lookOf(v.make, v.model);
    const charging = v.status === "charging" && v.at_home !== false;
    return {
      // The model's own shape when it has one; else what its dashboard car is set to be drawn as.
      body: look.known || !record ? look.body : record.car.car_body,
      paint: record ? paintOf(record.car.car_colour).hex : (v.colour ?? look.paint ?? PAINT.white.hex),
      label: [
        v.name || carTitle(v),
        v.soc != null && `${Math.round(v.soc)}%`,
        charging ? "Charging" : v.status === "away" && "Away",
      ]
        .filter(Boolean)
        .join(" · "),
      href: look.page(own ? own.id : null),
      charging,
      park: record?.car.car_park ?? "garage",
    };
  });
  const byHand = spare.map((c): HouseCar => ({
    body: c.car.car_body,
    paint: paintOf(c.car.car_colour).hex,
    label: [carName(c), c.level && `${Math.round(c.level.soc)}%`].filter(Boolean).join(" · "),
    href: `/integrations/ev/tesla/car/${c.id}`,
    park: c.car.car_park,
  }));
  return [...connected, ...byHand];
}
