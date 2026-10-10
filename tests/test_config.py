"""Settings read from the environment, for the dashboard and the collector: a mistyped one says which, and how."""

from __future__ import annotations

import pytest

from app.core.config import Config, ConfigError
from collector.config import Config as CollectorConfig
from collector.config import ConfigError as CollectorConfigError


def test_numbers_are_read() -> None:
    c = Config.from_env({"POLL_INTERVAL": " 120 ", "LATITUDE": "-33.87", "RAW_RETENTION_DAYS": "0"})
    assert (c.poll_interval, c.latitude, c.raw_retention_days) == (120, -33.87, 0)


def test_a_blank_number_means_the_default() -> None:
    assert Config.from_env({"POLL_INTERVAL": "", "PV_KW": "  "}).poll_interval == 60


def test_a_mistyped_number_names_the_setting_and_what_it_should_be() -> None:
    with pytest.raises(ConfigError) as e:
        Config.from_env({"POLL_INTERVAL": "60s", "LATITUDE": "south", "MAX_BACKOFF": "300"})
    assert e.value.problems == [
        "POLL_INTERVAL is '60s', which isn't a whole number. Set it to one, e.g. POLL_INTERVAL=60",
        "LATITUDE is 'south', which isn't a number. Set it to one, e.g. LATITUDE=-27.47",
    ]
    assert "Can't read the settings in the environment" in str(e.value)


def test_the_collector_names_a_mistyped_number_too() -> None:
    assert CollectorConfig.from_env({"COLLECTOR_PORT": "9000"}).port == 9000
    with pytest.raises(CollectorConfigError) as e:
        CollectorConfig.from_env({"COLLECTOR_RETENTION_DAYS": "1y"})
    assert e.value.problems == [
        "COLLECTOR_RETENTION_DAYS is '1y', which isn't a whole number. Set it to one, e.g. COLLECTOR_RETENTION_DAYS=365"
    ]
