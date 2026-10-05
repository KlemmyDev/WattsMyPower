"""Hisense appliances, through the ConnectLife app's cloud (see client.py for how it's reached, appliances.py for what
their properties mean)."""

from __future__ import annotations

from typing import Any, ClassVar

from app.features.home.integrations.connectlife.appliances import reading
from app.features.home.integrations.connectlife.client import ConnectLifeClient, Transport, _transport
from app.features.home.types import Field, Hints, Integration, Reading

TOKENS = ("access_token", "expires_at", "refresh_token", "refresh_expires_at")


class ConnectLife(Integration):
    id = "connectlife"
    name = "Hisense"
    via = "the ConnectLife app"
    about = (
        "Hisense washers and dryers in the ConnectLife app (Gorenje and ASKO too): when each runs, and what every cycle "
        "uses."
    )
    icon = "washer"
    kinds = ("washer", "dryer", "dishwasher")
    fields = (
        Field(
            "email", "Email", "email", placeholder="you@example.com", help="The email you sign in to ConnectLife with."
        ),
        Field(
            "password",
            "Password",
            "password",
            secret=True,
            help="Kept on this server, to sign in again when ConnectLife asks, and never shown. If you sign in to the "
            "app with Google or Apple, set a password first with “Forgot password” in the app.",
        ),
    )
    poll_seconds = 60
    # How requests are sent: replaced in tests.
    transport: ClassVar[Transport] = staticmethod(_transport)

    @classmethod
    def sign_in(cls, form: dict[str, str], hints: Hints) -> dict[str, Any]:
        client = ConnectLifeClient(form["email"], form["password"], transport=cls.transport)
        client.sign_in()
        return {"email": form["email"], "password": form["password"], **client.tokens}

    def label(self) -> str:
        return str(self.saved.get("email") or "")

    def poll(self) -> list[Reading]:
        client = ConnectLifeClient(
            str(self.saved.get("email") or ""),
            str(self.saved.get("password") or ""),
            {k: self.saved.get(k) for k in TOKENS},
            transport=type(self).transport,
        )
        try:
            appliances = client.appliances()
        finally:  # keep tokens refreshed on the way, even if the read then failed
            self.saved = {**self.saved, **client.tokens}
        return [r for d in appliances if (r := reading(d)) is not None]
