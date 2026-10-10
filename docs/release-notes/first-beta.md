The first public beta of WattsMyPower: a self-hosted dashboard for a Sungrow solar and battery system, run on a
computer on your home network, that reads the inverter directly and shows what your solar, battery, home and grid are
doing, what it's all costing, and what's coming. It's for Australian homes.

It runs one home's system every day, but it's new to everyone else's. Expect rough edges, and please tell us what
goes wrong.

## What's in it

- **Live readings from your inverter**, every minute, straight from a Sungrow SH hybrid over your network (WiNet-S,
  WiNet-S2 or the inverter's own port), with no cloud in between. An older Sungrow SG-D string inverter on the same
  house can be added as a second system.
- **Overview, Solar, Home, Battery and Grid pages:** the live power flow drawn as your house, today's cost and
  savings, each string of panels, where the home's power goes, the battery's health and whether it's the right size,
  and AEMO's wholesale prices and notices.
- **Battery controls:** standby, a floor it won't go below, or charging from the grid, for a set time.
- **Plan:** the next three days of solar, home use, battery and cost from the weather forecast, learning how your
  roof turns sunshine into solar.
- **Bills:** the current bill day by day against a budget, ways to lower it, plans from Energy Made Easy, NEM12 smart
  meter files, Amber Electric prices, and when the system pays for itself.
- **Outages and warnings:** Energex and Ergon Energy outages near you, and the Bureau of Meteorology's and Queensland
  Fire Department's warnings.
- **Home devices:** TP-Link Tapo and Shelly plugs, Home Assistant, Hisense washers and dryers, and Bluetti and
  EcoFlow portable batteries.
- **Electric vehicles:** a Tesla over the server's Bluetooth or through Tessie, charged from spare solar.
- **History** by year and by day, with iSolarCloud imports and CSV downloads, and **Manage → Data** showing
  everything that's stored.

[CHANGELOG.md](https://github.com/KlemmyDev/WattsMyPower/blob/main/CHANGELOG.md) has the full list.

## Tested on

- Sungrow **SH5.0RS** hybrid with a battery, through a **WiNet-S2**
- Sungrow **SG5K-D** as a second, AC-coupled system, through its older Wi-Fi dongle
- Docker in a Proxmox LXC container

Other SH hybrids share the SH5.0RS's registers and should work, but haven't been tried. If you have one, we'd love to
hear how it goes.

## Known issues

- **Battery controls** are on for SH-RS hybrids, and used at home on an SH5.0RS. On any other model they're off
  until you turn them on for that inverter on the Battery page, as they haven't been tried there.
- **Tesla through Tessie, Bluetti, EcoFlow, Shelly, Home Assistant and Amber** have had little or no use beyond our
  own hardware.
- **Hisense ConnectLife** has no public API, so it can stop working if Hisense changes it.
- The **WiNet-S2** sometimes repeats the same readings for a few minutes; those are left out, so charts show a short
  gap.
- Only one app should talk to the inverter at a time (not Home Assistant or SunGather as well).
- **Outages and bushfire warnings** cover Queensland only so far. Plan comparison leaves out controlled load and
  demand charges.
- It's served over plain HTTP with one household account: keep it on your home network, and don't port-forward it.
- Bluetooth in a Proxmox LXC needs a one-time set-up on the Proxmox host. Windows 10 isn't supported.

## Installing

On Linux (a Raspberry Pi, a Proxmox LXC or VM, any Debian or Ubuntu box) or a Mac with Docker Desktop:

```bash
curl -fsSL https://raw.githubusercontent.com/KlemmyDev/WattsMyPower/main/install.sh | bash
```

On Windows 11, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/KlemmyDev/WattsMyPower/main/install.ps1 | iex
```

Then open the address it prints, create the dashboard's account, and the set-up guide connects your inverter. A new
install follows the beta channel. The [README](https://github.com/KlemmyDev/WattsMyPower#install) has the details for
each computer.

## Switching an existing install to beta

In **Manage → System → Updates**, set **Channel** to **Beta**, then **Update now** (or **Go back**, coming from
Nightly). Or, from the `wattsmypower` folder:

```bash
bash install.sh --channel beta
```

Both databases are backed up to `data/backups/` first, as on every update.

## Reporting a bug

[Open an issue](https://github.com/KlemmyDev/WattsMyPower/issues/new/choose). The form asks for the version and
commit from **Manage → System → Updates**, how it's installed, your inverter and the last of the logs
(`docker compose logs --tail=200`). Security problems go privately instead: see the
[security policy](https://github.com/KlemmyDev/WattsMyPower/security/policy).
