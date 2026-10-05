"""
Every home integration the dashboard can connect. To add one: write a module under app.features.home.integrations
with an Integration subclass (app.features.home.types), and list it here. The settings page, the connect form,
polling, energy and the Home page all follow from that.
"""

from __future__ import annotations

from app.features.home.integrations.connectlife import ConnectLife
from app.features.home.integrations.demo import Demo
from app.features.home.integrations.homeassistant import HomeAssistant
from app.features.home.integrations.shelly import Shelly
from app.features.home.integrations.tapo import Tapo
from app.features.home.types import Integration

INTEGRATIONS: dict[str, type[Integration]] = {i.id: i for i in (Tapo, Shelly, ConnectLife, HomeAssistant, Demo)}
