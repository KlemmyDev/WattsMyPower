from __future__ import annotations

import time
from typing import Any, ClassVar

import pytest

from app.core.config import Config
from app.core.database import Database
from app.features.home import rules
from app.features.home.rules import Conditions, RuleError, decide, validate
from app.features.home.service import HomeService, HomeSetupError
from app.features.home.types import Hints, Integration, Reading

NOON = time.mktime((2026, 10, 6, 12, 0, 0, 0, 0, -1))
RULE = validate({"start_w": 1500, "stop_w": 300}, "plug")


def test_a_rule_is_checked() -> None:
    assert RULE == {"enabled": True, "start_w": 1500, "stop_w": 300, "from": None, "until": None, "max_price": None}
    assert validate({"from": "22:00", "until": "06:00", "max_price": 0.3}, "plug")["until"] == "06:00"
    for bad, words in [
        ({"start_w": 50}, "100 W"),
        ({"stop_w": "lots"}, "watts"),
        ({"from": "9am", "until": "15:00"}, "HH:MM"),
        ({"from": "09:00"}, "both"),
        ({"from": "09:00", "until": "09:00"}, "same"),
        ({"max_price": "cheap"}, "dollars"),
    ]:
        with pytest.raises(RuleError, match=words):
            validate(bad, "plug")
    with pytest.raises(RuleError, match="food cold"):
        validate({}, "freezer")


def test_on_with_spare_solar_off_without_and_never_flicking() -> None:
    sunny, cloudy, between = Conditions(2000, 0.3), Conditions(-500, 0.3), Conditions(500, 0.3)
    assert decide(RULE, {}, False, sunny, NOON) == (True, "spare solar")
    assert decide(RULE, {}, False, between, NOON) is None
    assert decide(RULE, {}, True, between, NOON) is None  # still using what it would've exported, less its own draw
    assert decide(RULE, {}, True, cloudy, NOON) == (False, "no spare solar")
    assert decide(RULE, {"at": NOON - 300}, True, cloudy, NOON) is None  # switched 5 minutes ago: it waits
    assert decide(RULE, {}, False, Conditions(None, 0.3), NOON) is None  # nothing to go on


def test_hours_a_price_limit_and_switching_by_hand() -> None:
    hours = {**RULE, "from": "09:00", "until": "15:00"}
    evening = NOON + 6 * 3600
    assert decide(hours, {"on_by_rule": True}, True, Conditions(2000, 0.3), evening) == (False, "outside its hours")
    assert decide(hours, {"on_by_rule": False}, True, Conditions(2000, 0.3), evening) is None  # on by hand: left
    night = {**RULE, "from": "22:00", "until": "06:00"}
    assert rules.in_window(night, NOON - 10 * 3600) and not rules.in_window(night, NOON)
    capped = {**RULE, "max_price": 0.25}
    assert decide(capped, {}, False, Conditions(2000, 0.40), NOON) is None
    assert decide(capped, {}, True, Conditions(2000, 0.40), NOON) == (False, "power costs more than its limit")
    assert decide(RULE, {"paused_until": NOON + 60}, False, Conditions(2000, 0.3), NOON) is None
    assert decide({**RULE, "enabled": False}, {}, False, Conditions(2000, 0.3), NOON) is None


class Plug(Integration):
    """One switchable plug, on or off as last switched."""

    id = "plug"
    name = "Plug"
    via = "the network"
    about = "A plug"
    category = "plugs"
    kinds = ("plug",)
    fields = ()
    can_switch = True
    on: ClassVar[bool] = False
    switched: ClassVar[list[bool]] = []

    @classmethod
    def sign_in(cls, form: dict[str, str], hints: Hints) -> dict[str, Any]:
        return {}

    def poll(self) -> list[Reading]:
        return [Reading("p", "Pool pump", "plug", power_w=900.0 if Plug.on else 0.0, switched_on=Plug.on)]

    def switch(self, key: str, on: bool) -> None:
        Plug.on = on
        Plug.switched.append(on)


def test_the_service_follows_a_rule_and_waits_after_switching_by_hand(db: Database, config: Config) -> None:
    Plug.on, Plug.switched = False, []
    clock = [NOON]
    now = {"export_w": 2500.0}
    home = HomeService(
        config, db, {"plug": Plug}, clock=lambda: clock[0], conditions=lambda: Conditions(now["export_w"], 0.3)
    )
    home.connect("plug", {})
    home.poll_due()
    (pump,) = home.repo.devices()
    home.set_rule(pump.id, {"start_w": 1500, "stop_w": 300})
    home.automate()
    assert Plug.switched == [True]
    view = next(d for d in home.overview()["devices"] if d["id"] == pump.id)
    assert view["rule"]["last"] == {"at": int(NOON), "on": True, "why": "spare solar"}

    now["export_w"] = -800.0  # a cloud: it's drawing from the grid
    clock[0] += 300
    home.poll_due(clock[0] + 60)
    home.automate()
    assert Plug.switched == [True]  # 5 minutes since it switched: it waits
    clock[0] += 600
    home.poll(pump.account)  # read again: a reading three polls old isn't acted on
    home.automate()
    assert Plug.switched == [True, False]

    # Switched on by hand, it stays on for the rest of the day, cloud or not.
    home.switch(pump.id, True)
    clock[0] += 3600
    home.poll(pump.account)
    home.automate()
    assert Plug.switched == [True, False, True]
    with pytest.raises(HomeSetupError, match="food cold"):
        home.update_device(pump.id, {"kind": "freezer"})
        home.set_rule(pump.id, {})
