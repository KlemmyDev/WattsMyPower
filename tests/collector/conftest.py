from __future__ import annotations

from pathlib import Path

import pytest

from collector.config import Config
from collector.devices import RawReading, Words
from collector.store import Store


@pytest.fixture
def cfg(tmp_path: Path) -> Config:
    return Config(db_path=str(tmp_path / "collector.db"), token="secret", poll_interval=60, max_backoff=300)


@pytest.fixture
def store(cfg: Config) -> Store:
    s = Store(cfg.db_path, cfg.retention_days)
    s.migrate()
    return s


class FakeDevice:
    """A device that answers with fixed words, or raises while `fail` is set. Records each read's include_info."""

    def __init__(self, name: str = "hybrid", host: str = "10.0.0.1", words: Words | None = None):
        self.name, self.host = name, host
        self.driver = "sungrow.sh_rs" if name == "hybrid" else "sungrow.sg_d"
        self.words = words if words is not None else {5008: 312, 5017: 4120, 5018: 0}
        self.info: Words = {4990: 16691, 5000: 3597}
        self.info_holding: Words = {13059: 50}
        self.fail = False
        self.calls: list[bool] = []

    def read(self, include_info: bool) -> RawReading:
        self.calls.append(include_info)
        if self.fail:
            raise ConnectionError(f"{self.name} down")
        if not include_info:
            return RawReading(input=dict(self.words))
        return RawReading(
            input={**self.info, **self.words},
            holding=dict(self.info_holding),
            info_input=dict(self.info),
            info_holding=dict(self.info_holding),
        )


class Clock:
    def __init__(self, t: float = 1_790_850_000.0):
        self.t = t

    def __call__(self) -> float:
        return self.t
