"""
Electrolux, AEG, Frigidaire and +home (Westinghouse, Kelvinator) appliances, through Electrolux Group's official
Developer API (client.py; what their state means is in appliances.py). All of them are Electrolux Group appliances
that report only to Electrolux's cloud, with no protocol on the home network, so this is one of the few integrations
that needs the internet.

It matters for a "Westinghouse fridge with an app": in Australia no Westinghouse-branded fridge has Wi-Fi (the
connected ones are Electrolux-branded, in the Electrolux app), and Westinghouse's own connected products are air
conditioners in the +home app. Either way they're on an Electrolux Group account, which is what this reads.

Connecting takes the API key and tokens made at developer.electrolux.one, lists the account's appliances and keeps
each one (its name, type, brand and model). The free tier allows 5,000 requests a day, so it's careful with them:
the list is asked for again once an hour (to notice appliances added or renamed), and each appliance's state every
5 minutes (288 a day each, so up to about 15 appliances fit). A 429 waits as long as Electrolux says, and other
failures back off as every integration's do (app.features.home.service). Nothing is ever sent to the appliances:
this only reads (the API's command endpoint is left alone).

The access and refresh tokens change every time they're refreshed (about every 12 hours), and only the newest pair
works: they're kept in `self.saved` the moment they change, which the service saves even when the poll then fails.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any, ClassVar

from app.features.home.integrations.electrolux.appliances import reading
from app.features.home.integrations.electrolux.client import ElectroluxClient, Transport, _transport, token_expiry
from app.features.home.types import Field, Hints, Integration, IntegrationError, Reading, mask

log = logging.getLogger(__name__)

LIST_EVERY = 3600  # seconds between asking for the account's list of appliances again
PORTAL = "developer.electrolux.one"


def _token(value: str) -> str:
    """A token as pasted: without spaces or a "Bearer " in front."""
    return value.strip().removeprefix("Bearer ").strip()


def _brand(value: str) -> str | None:
    """A brand as it's written: "ELECTROLUX" as "Electrolux", but "AEG" as it is."""
    value = value.strip()
    return (value.title() if value.isupper() and len(value) > 3 else value) or None


class Electrolux(Integration):
    id = "electrolux"
    name = "Electrolux"
    via = "Electrolux Group's developer API"
    about = (
        "Electrolux, AEG, Frigidaire and Westinghouse appliances in the Electrolux, AEG or +home app: each fridge's "
        "temperatures, doors and alerts, and when washers, dryers, dishwashers and ovens run. Through Electrolux's "
        "cloud: there's no local way to reach them."
    )
    icon = "fridge"
    kinds = ("fridge", "freezer", "washer", "dryer", "washer_dryer", "dishwasher", "oven", "air_conditioner")
    fields = (
        Field(
            "api_key",
            "API key",
            "password",
            secret=True,
            help=f"Sign in at {PORTAL} with the account your appliances are in (the one you use in the Electrolux, "
            "AEG or +home app), open Dashboard and create an API key. Kept on this server and only ever sent to "
            "Electrolux.",
        ),
        Field(
            "refresh_token",
            "Refresh token",
            "password",
            secret=True,
            help="On the same Dashboard, press GET ACCESS TOKEN and copy the refresh token it shows. It's swapped "
            "for a new one about every 12 hours, so use a fresh one each time you sign in here.",
        ),
        Field(
            "access_token",
            "Access token",
            "password",
            secret=True,
            optional=True,
            help="Shown beside the refresh token. If you leave it empty, one is fetched with the refresh token.",
        ),
    )
    poll_seconds = 300
    # How requests are sent, and the time: replaced in tests.
    transport: ClassVar[Transport] = staticmethod(_transport)
    clock: ClassVar[Callable[[], float]] = staticmethod(time.time)

    @classmethod
    def _tokens(cls, saved: dict[str, Any]) -> dict[str, Any]:
        return {k: saved.get(k) for k in ("access_token", "refresh_token", "expires_at")}

    @classmethod
    def _list(cls, client: ElectroluxClient, known: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
        """The account's appliances by id, with what's known of each: its name and type from the list, and its brand
        and model from its info (asked once per appliance; again next time if that failed)."""
        found: dict[str, dict[str, Any]] = {}
        for a in client.appliances():
            aid = str(a["applianceId"])
            entry = {**known.get(aid, {}), "name": str(a.get("applianceName") or "").strip() or "Appliance",
                     "type": str(a.get("applianceType") or "")}  # fmt: skip
            if not entry.get("described"):
                try:
                    about = client.info(aid)
                except IntegrationError as e:
                    if e.signed_out or e.retry_after:
                        raise
                    log.info("Electrolux %s's info: %s", aid, e)
                else:
                    i = about.get("applianceInfo") or {}
                    entry.update(
                        described=True,
                        brand=_brand(str(i.get("brand") or "")),
                        model=str(i.get("model") or "").strip() or None,
                        pnc=str(i.get("pnc") or "").strip() or None,
                        device_type=str(i.get("deviceType") or "").strip() or None,
                    )
            found[aid] = entry
        return found

    @classmethod
    def sign_in(cls, form: dict[str, str], hints: Hints) -> dict[str, Any]:
        access = _token(form.get("access_token") or "")
        tokens = {"access_token": access or None, "refresh_token": _token(form["refresh_token"]),
                  "expires_at": token_expiry(access) if access else None}  # fmt: skip
        client = ElectroluxClient(form["api_key"], tokens, cls.transport, cls.clock)
        appliances = cls._list(client, {})
        if not appliances:
            used = client.tokens.get("refresh_token") != tokens["refresh_token"]
            raise IntegrationError(
                "Electrolux accepted the key and tokens, but the account has no appliances. Add them in the "
                "Electrolux, AEG or +home app first (or sign in at the portal with the account they're in)"
                + (", then get new tokens: the ones entered have been swapped for others." if used else ".")
            )
        return {
            "api_key": client.api_key,
            **client.tokens,
            "appliances": appliances,
            "listed_at": cls.clock(),
        }

    def label(self) -> str:
        n = len(self.saved.get("appliances", {}))
        return f"{n} appliance{'s' if n != 1 else ''} · key {mask(str(self.saved.get('api_key') or ''))}"

    def poll(self) -> list[Reading]:
        cls = type(self)
        client = ElectroluxClient(
            str(self.saved.get("api_key") or ""), cls._tokens(self.saved), cls.transport, cls.clock
        )
        try:
            return self._poll(client)
        finally:  # keep the newest tokens, even if the read then failed: the old refresh token no longer works
            self.saved = {**self.saved, **client.tokens}

    def _poll(self, client: ElectroluxClient) -> list[Reading]:
        cls = type(self)
        appliances: dict[str, dict[str, Any]] = self.saved.get("appliances", {})
        if cls.clock() - float(self.saved.get("listed_at") or 0) >= LIST_EVERY:
            try:
                appliances = cls._list(client, appliances)
            except IntegrationError as e:
                if e.signed_out or e.retry_after or not appliances:
                    raise
                log.info("Electrolux's list of appliances: %s (reading the ones known)", e)
            else:
                self.saved = {**self.saved, "appliances": appliances, "listed_at": cls.clock()}
        readings: list[Reading] = []
        problems: list[IntegrationError] = []
        for aid, entry in appliances.items():
            try:
                state = client.state(aid)
            except IntegrationError as e:
                if e.signed_out or e.retry_after:
                    raise
                log.info("Electrolux %s: %s", aid, e)
                problems.append(e)
                state = None
            readings.append(reading(aid, entry, state))
        if appliances and len(problems) == len(appliances):
            raise problems[0]
        return readings
