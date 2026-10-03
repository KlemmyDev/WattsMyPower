"""
Learning how this system turns weather into solar, from stored weather and what the panels really made.

The plain forecast multiplies flat-ground sunlight by one number fitted on the last week. That misses
what a roof does through a day and a year: panels facing north-east make more in the morning than the
afternoon; a tree or the neighbour's house shades them when the sun is low in winter; heat costs a few
per cent; the inverter caps what it can put out. The learned model fits each of those from history:

  1. Sunlight on the panels' plane (app.features.weather.sun), from the tilt and direction set in
     Settings, or flat ground when they aren't.
  2. How much the system makes per unit of that sunlight for each patch of sky the sun can be in
     (by height and compass bearing). A patch with little history leans on the overall figure.
  3. A correction for how cloudy the forecast says it is, as forecasts tend to be too sunny or too
     dull in particular conditions.
  4. A temperature effect (panels lose a little output as they heat up).
  5. The most the system makes in an hour, as the inverter clips anything more.

Hours when the battery was full and output fell well short of the sunshine are left out: the
inverter may have been holding solar back for an export limit, which says nothing about the panels.

Whether it's used is decided by a back-test: for each of the last few weeks' days, a model trained only
on the days before it forecasts that day, and so does the plain forecast as it would have stood. The
learned model is used only when it has been the closer of the two.
"""

from __future__ import annotations

import statistics
from bisect import bisect
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from typing import Any

from app.features.weather.sun import Panels, hour_sun

ELEVATION_EDGES = (10, 20, 30, 45, 60)  # degrees: the sky patches' rows
AZIMUTH_STEP = 30  # degrees: their columns
CLOUD_EDGES = (25, 50, 75)  # % cloud cover
CELL_WEIGHT = 1.0  # kWh/m² of sunlight a patch needs before its own figure counts as much as the overall one
CLOUD_WEIGHT = 2.0  # kWh made before a cloud band's own correction counts as much as none
MIN_SUN = 0.03  # kWh/m² on the panels in an hour: less than this is dawn or dusk, too noisy to learn from
HELD_BACK = 0.6  # a full battery and less than this share of the expected output: possibly held back
GAMMA_RANGE = (-0.006, 0.0)  # per °C above 25 °C: crystalline panels lose 0.3-0.5 %
MIN_SAMPLES = 60  # daylight hours needed to fit at all
MIN_TRAIN_DAYS = 10  # days of history before a back-test day for it to count
BACKTEST_DAYS = 21
MIN_BACKTEST_DAYS = 7
BETTER_BY = 0.97  # the learned model must be at least 3 % closer than the plain one to be used
SIMPLE_DAYS = 7  # the plain forecast is fitted on the last week


@dataclass
class Sample:
    """One hour: the sunshine and weather, and (for hours past) what the panels made."""

    ts: int
    day: str
    ghi: float  # kWh/m² on flat ground over the hour
    poa: float  # kWh/m² on the panels' plane over the hour
    cell: str
    cloud: float | None
    temp: float | None
    actual: float | None = None  # kWh made
    full: bool = False  # the battery was full for some of the hour


def cell(elevation: float, azimuth: float) -> str:
    return f"{bisect(ELEVATION_EDGES, max(elevation, 0))}:{int(azimuth // AZIMUTH_STEP) % (360 // AZIMUTH_STEP)}"


def cloud_band(cloud: float | None) -> int:
    return bisect(CLOUD_EDGES, cloud) if cloud is not None else 1


def sample(row: dict[str, Any], panels: Panels, day: str) -> Sample:
    """A stored weather hour (app.features.weather.repository) as the model sees it."""
    sun = hour_sun(row["ts"], row.get("ghi"), row.get("dni"), row.get("dhi"), panels)
    return Sample(
        ts=row["ts"],
        day=day,
        ghi=max(row.get("ghi") or 0.0, 0.0) / 1000,
        poa=sun.poa / 1000,
        cell=cell(sun.elevation, sun.azimuth),
        cloud=row.get("cloud"),
        temp=row.get("temp"),
    )


@dataclass
class SolarModel:
    k: float  # kWh per kWh/m² on the panels, overall
    cells: dict[str, float]  # the same for each sky patch
    clouds: list[float]  # output factor for each cloud band
    gamma: float  # change in output per °C above 25 °C
    cap: float  # the most kWh in an hour

    def predict(self, s: Sample) -> float:
        """kWh the panels should make in the hour."""
        if s.poa <= 0:
            return 0.0
        heat = 1 + self.gamma * ((s.temp if s.temp is not None else 25.0) - 25)
        k = self.cells.get(s.cell, self.k)
        return min(self.cap, max(0.0, k * s.poa * self.clouds[cloud_band(s.cloud)] * heat))

    def to_json(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_json(cls, data: dict[str, Any]) -> SolarModel:
        return cls(**data)


def _daily_ratio(samples: list[Sample], sunlight: str) -> float | None:
    """The median day's kWh made per kWh/m² of `sunlight` ("poa" or "ghi")."""
    by_day: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
    for s in samples:
        if s.actual is not None:
            sums = by_day[s.day]
            sums[0] += s.actual
            sums[1] += getattr(s, sunlight)
    ratios = [made / sun for made, sun in by_day.values() if sun >= 0.5]
    return statistics.median(ratios) if ratios else None


def fit(samples: list[Sample], pv_kw: float) -> SolarModel | None:
    """The learned model from hours with known output, or None with too little to learn from."""
    usable = [s for s in samples if s.actual is not None and s.poa >= MIN_SUN and 0 <= s.actual <= 1.5 * pv_kw]
    if len(usable) < MIN_SAMPLES:
        return None
    k = _daily_ratio(usable, "poa")
    if k is None:
        return None
    train = [s for s in usable if not (s.full and (s.actual or 0) < HELD_BACK * k * s.poa)]
    model = SolarModel(k=k, cells={}, clouds=[1.0] * (len(CLOUD_EDGES) + 1), gamma=0.0, cap=1.2 * pv_kw)

    def heat(s: Sample) -> float:
        return 1 + model.gamma * ((s.temp if s.temp is not None else 25.0) - 25)

    for _ in range(3):  # each part given the others' latest fit
        sums: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])
        for s in train:
            c = sums[s.cell]
            c[0] += s.actual or 0
            c[1] += s.poa * model.clouds[cloud_band(s.cloud)] * heat(s)
        model.cells = {c: (made + CELL_WEIGHT * k) / (sun + CELL_WEIGHT) for c, (made, sun) in sums.items()}

        bands: dict[int, list[float]] = defaultdict(lambda: [0.0, 0.0])
        for s in train:
            b = bands[cloud_band(s.cloud)]
            b[0] += s.actual or 0
            b[1] += model.cells.get(s.cell, k) * s.poa * heat(s)
        model.clouds = [
            min(max((bands[i][0] + CLOUD_WEIGHT) / (bands[i][1] + CLOUD_WEIGHT), 0.4), 1.6)
            for i in range(len(CLOUD_EDGES) + 1)
        ]

        num = den = 0.0
        for s in train:
            if s.temp is None:
                continue
            expected = model.cells.get(s.cell, k) * s.poa * model.clouds[cloud_band(s.cloud)]
            if expected <= 0:
                continue
            x = s.temp - 25
            num += expected * x * ((s.actual or 0) / expected - 1)
            den += expected * x * x
        model.gamma = min(max(num / den, GAMMA_RANGE[0]), GAMMA_RANGE[1]) if den else 0.0

    made = sorted(s.actual or 0 for s in usable)
    if len(made) >= 100:
        model.cap = max(made[int(len(made) * 0.995)] * 1.02, 0.1)
    return model


@dataclass
class Backtest:
    days: int = 0
    learned_mae: float | None = None  # kWh a day, on average, the learned forecast was out by
    simple_mae: float | None = None  # the same for the plain forecast
    learned_bias: float | None = None  # kWh a day, on average, it forecast too much (+) or too little (−)
    simple_bias: float | None = None
    actual_mean: float | None = None  # kWh a day the panels made, on average, over those days
    per_day: list[dict[str, Any]] = field(default_factory=list)

    @property
    def better(self) -> bool:
        return (
            self.days >= MIN_BACKTEST_DAYS
            and self.learned_mae is not None
            and self.simple_mae is not None
            and self.learned_mae <= self.simple_mae * BETTER_BY
        )

    def to_json(self) -> dict[str, Any]:
        return asdict(self)


def backtest(samples: list[Sample], pv_kw: float, days: int = BACKTEST_DAYS) -> Backtest:
    """Forecast each of the last `days` days from only the days before it, both ways, and compare."""
    by_day: dict[str, list[Sample]] = defaultdict(list)
    for s in samples:
        by_day[s.day].append(s)
    known = sorted(d for d, hours in by_day.items() if sum(1 for s in hours if s.actual is not None) >= 8)
    results: list[dict[str, Any]] = []
    for d in known[-days:]:
        before = [x for x in known if x < d]
        if len(before) < MIN_TRAIN_DAYS:
            continue
        model = fit([s for x in before for s in by_day[x]], pv_kw)
        simple_k = _daily_ratio([s for x in before[-SIMPLE_DAYS:] for s in by_day[x]], "ghi")
        if model is None or simple_k is None:
            continue
        hours = [s for s in by_day[d] if s.actual is not None]
        actual = sum(s.actual or 0 for s in hours)
        learned = sum(model.predict(s) for s in hours)
        simple = sum(simple_k * s.ghi for s in hours)
        results.append({"day": d, "actual": round(actual, 2), "learned": round(learned, 2), "simple": round(simple, 2)})
    if not results:
        return Backtest()
    n = len(results)
    return Backtest(
        days=n,
        learned_mae=round(sum(abs(r["learned"] - r["actual"]) for r in results) / n, 2),
        simple_mae=round(sum(abs(r["simple"] - r["actual"]) for r in results) / n, 2),
        learned_bias=round(sum(r["learned"] - r["actual"] for r in results) / n, 2),
        simple_bias=round(sum(r["simple"] - r["actual"] for r in results) / n, 2),
        actual_mean=round(sum(r["actual"] for r in results) / n, 2),
        per_day=results,
    )
