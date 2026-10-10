"""
Electric cars and their usual details: a connected Tesla's model, and the cars added by hand in earlier versions, so their details
don't need looking up. Choosing one fills in the details, which can then be changed: the figures are typical,
not exact for every build year.

    battery_kwh  the battery's usable size
    wh_per_km    what it uses on the road, mixed driving in mild weather
    ac_kw        the most it takes from an AC charger at home, on `phases` phases (a car limited to one phase
                 uses one even on a three-phase charger)
    min_amps     the lowest current it charges at: 5 A for a Tesla, 6 A (the charging standard's floor) otherwise
    lfp          a lithium iron phosphate battery, which its maker says to charge to 100% regularly, rather than
                 the 80 or 90% day to day other lithium batteries are kept at
    body         how the Overview draws it: its own shape for some popular models, else a sedan, SUV or hatch
"""

from __future__ import annotations

from typing import Any

VOLTS = 230.0

# The shapes the Overview can draw a car as: some popular models of their own, and three of every other.
BODIES = (
    "model3", "modelY", "modelS", "modelX", "cybertruck", "atto3", "dolphin", "seal", "sealion7", "ioniq5",
    "sedan", "suv", "hatch",
)  # fmt: skip
# Each model's shape, by the start of its id; any other is an SUV.
_BODY_BY_ID = {
    "tesla-model-3": "model3", "tesla-model-y": "modelY", "byd-atto-3": "atto3", "byd-dolphin": "dolphin",
    "byd-seal-": "seal", "byd-sealion-7": "sealion7", "hyundai-ioniq-5": "ioniq5", "hyundai-ioniq-6": "sedan",
    "polestar-2": "sedan", "mg-4": "hatch", "nissan-leaf": "hatch", "cupra-born": "hatch", "gwm-ora": "hatch",
}  # fmt: skip


def body_of(model_id: str | None) -> str:
    """How a catalog model is drawn."""
    return next((b for prefix, b in _BODY_BY_ID.items() if (model_id or "").startswith(prefix)), "suv")


def _car(
    id: str,
    make: str,
    model: str,
    battery_kwh: float,
    wh_per_km: float,
    ac_kw: float,
    phases: int,
    *,
    lfp: bool = False,
) -> dict[str, Any]:
    return {
        "id": id,
        "make": make,
        "model": model,
        "battery_kwh": battery_kwh,
        "wh_per_km": wh_per_km,
        "ac_kw": ac_kw,
        "phases": phases,
        "max_amps": min(32, round(ac_kw * 1000 / (VOLTS * phases))),
        "min_amps": 5 if make == "Tesla" else 6,
        "lfp": lfp,
        "target_soc": 100 if lfp else 80,
        "body": body_of(id),
    }


MODELS: list[dict[str, Any]] = [
    _car("tesla-model-3-rwd", "Tesla", "Model 3 Rear-Wheel Drive", 57.5, 135, 11, 3, lfp=True),
    _car("tesla-model-3-lr", "Tesla", "Model 3 Long Range", 75, 145, 11, 3),
    _car("tesla-model-3-perf", "Tesla", "Model 3 Performance", 75, 160, 11, 3),
    _car("tesla-model-y-rwd", "Tesla", "Model Y Rear-Wheel Drive", 57.5, 150, 11, 3, lfp=True),
    _car("tesla-model-y-lr", "Tesla", "Model Y Long Range", 75, 160, 11, 3),
    _car("tesla-model-y-perf", "Tesla", "Model Y Performance", 75, 175, 11, 3),
    _car("byd-atto-3-standard", "BYD", "Atto 3 Standard Range", 49.9, 165, 7.4, 1, lfp=True),
    _car("byd-atto-3-extended", "BYD", "Atto 3 Extended Range", 60.5, 170, 7.4, 1, lfp=True),
    _car("byd-dolphin-essential", "BYD", "Dolphin Essential", 44.9, 145, 7.4, 1, lfp=True),
    _car("byd-dolphin-premium", "BYD", "Dolphin Premium", 60.5, 150, 7.4, 1, lfp=True),
    _car("byd-seal-premium", "BYD", "Seal Premium", 82.5, 165, 7.4, 1, lfp=True),
    _car("byd-sealion-7", "BYD", "Sealion 7", 82.5, 185, 11, 3, lfp=True),
    _car("mg-4-51", "MG", "MG4 51 kWh", 50.8, 160, 7.4, 1, lfp=True),
    _car("mg-4-64", "MG", "MG4 64 kWh", 61.7, 165, 11, 3),
    _car("mg-zs-ev", "MG", "ZS EV", 49, 175, 7.4, 1, lfp=True),
    _car("hyundai-ioniq-5", "Hyundai", "Ioniq 5 (77 kWh)", 74, 180, 11, 3),
    _car("hyundai-ioniq-6", "Hyundai", "Ioniq 6 (77 kWh)", 74, 150, 11, 3),
    _car("hyundai-kona-electric", "Hyundai", "Kona Electric (65 kWh)", 64.8, 155, 11, 3),
    _car("kia-ev6", "Kia", "EV6 (77 kWh)", 74, 175, 11, 3),
    _car("kia-niro-ev", "Kia", "Niro EV", 64.8, 160, 11, 3),
    _car("kia-ev5", "Kia", "EV5 Long Range", 88, 185, 11, 3),
    _car("polestar-2-lr", "Polestar", "Polestar 2 Long Range", 79, 170, 11, 3),
    _car("volvo-ex30-extended", "Volvo", "EX30 Extended Range", 64, 165, 11, 3),
    _car("nissan-leaf-40", "Nissan", "Leaf (40 kWh)", 39, 165, 6.6, 1),
    _car("nissan-leaf-plus", "Nissan", "Leaf e+ (62 kWh)", 59, 175, 6.6, 1),
    _car("cupra-born", "Cupra", "Born (59 kWh)", 58, 165, 11, 3),
    _car("vw-id4-pro", "Volkswagen", "ID.4 Pro", 77, 175, 11, 3),
    _car("bmw-ix1", "BMW", "iX1 eDrive20", 64.7, 165, 11, 3),
    _car("gwm-ora-ultra", "GWM", "Ora Ultra (63 kWh)", 63, 160, 6.6, 1, lfp=True),
]

BY_ID = {m["id"]: m for m in MODELS}
