# Changelog

What's changed in each release of WattsMyPower. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions are dates (`2026.10.10`, then `.1`, `.2` for a second release that day), and a beta's tag adds `-beta`
(`v2026.10.10-beta`, then `-beta.2`). Nightly installs follow `main` and aren't listed here.

## [Unreleased]

The first public beta. WattsMyPower runs one home's system every day; this is the first release for everyone else.
Everything below is new. When it's released, this heading becomes the beta's version and date.

### Added

- **Reading the inverters on your own network.** A separate collector reads a Sungrow SH hybrid (and its battery and
  grid meter) over Modbus TCP through its WiNet-S or WiNet-S2 dongle every minute, with no cloud in between, and keeps
  the raw registers. An optional second, older Sungrow SG-D string inverter (an AC-coupled system) is read through its
  Wi-Fi dongle's encrypted Modbus, and both count. Inverters are found by scanning the network in **Manage →
  Integrations**. A newer SH hybrid that isn't known by name is read with the same registers and shown as untested.
- **GoodWe inverters (untested):** GoodWe's ET-family hybrids (ET, EH, BT, BH) with their battery and meter, and its
  DT-family string inverters (D-NS, XS, DT) as a second system, read on your network over Modbus on UDP port 8899
  (or Modbus TCP on a newer LAN dongle) and found by the same network scan. Their registers follow the `goodwe`
  library that Home Assistant uses; they haven't been tried on a real GoodWe yet.
- **Overview:** the live power flow as an animated house that follows the weather (and can be made to look like
  yours), today's cost and savings at your rates, the battery's last six hours and the next 24 hours.
- **Solar, Home, Battery and Grid pages**, each opening on a summary: what the panels are making against the forecast,
  each string; where the home's power goes, from the inverter and from connected plugs and appliances; the battery's
  level, health, warranty and whether it's the right size; the grid's state, AEMO's wholesale prices and notices,
  voltage and frequency at the house.
- **Battery controls:** standby, a floor it won't discharge below, or charging from the grid, for a set time, then
  back to normal. They stand aside while iSolarCloud has the battery.
- **Outages and warnings:** Energex and Ergon Energy outages near you (Queensland), matched to your street on your own
  server; the Bureau of Meteorology's warnings for your district; Queensland Fire Department bushfire warnings.
- **Plan:** today and the next two days of solar, home use, battery and cost from Open-Meteo's forecast, calibrated to
  your system and learning how your roof turns sunshine into solar, with the best times to use power and warnings
  when the battery will run down or won't fill.
- **History:** a calendar-year heatmap by solar, self-sufficiency, grid import, savings or weather; any day in
  5-minute steps; CSV downloads; history imported from iSolarCloud's exports.
- **Bills:** the current billing period day by day against a budget, ways to lower the bill, what grid power costs
  by hour, the next few bills, and the return on your system. Rates are single rate or time of use, entered by hand
  or found on Energy Made Easy. NEM12 smart meter files can replace the inverter's figures where they cover a day.
  Amber Electric customers can follow Amber's prices.
- **Home devices:** TP-Link Tapo plugs (KLAP and TPAP) and Shelly plugs and meters read on your network; Home
  Assistant's measured devices; Hisense (ConnectLife) washers and dryers; Bluetti (Bluetooth) and EcoFlow (cloud)
  portable batteries. Each shows when it runs, what it uses, and its usual days and times.
- **Electric vehicles:** your cars drawn in the garage; a Tesla over the server's Bluetooth or through Tessie, charged
  from spare solar a step at a time (Standard, Quick, Steady or Custom timing), with each charge and trip logged and
  the car's day charted.
- **Manage → Data:** everything both databases hold, table by table.
- **Sign-in** with one household account, created on the first visit, and a set-up guide for the inverter, system,
  rates, location and billing period.
- **Install and updates:** one command on Linux (including Raspberry Pi and Proxmox LXC), a Mac or Windows 11 (in
  WSL). Updates back up both databases first, and can be started from **Manage → System → Updates**. Releases come on
  three channels: nightly, beta and stable.
- A dark and a light theme, drag-to-zoom on every day chart, and layouts for phones.

### Known issues

- Battery controls are on for the SH-RS hybrids they were written for, and used at home on an SH5.0RS. On any other
  model they're off until turned on for that inverter, as they haven't been tried there.
- Hisense ConnectLife has no public API: it's read the way its app reads it, and can stop working if Hisense changes
  it.
- The WiNet-S2 sometimes repeats the same readings for a few minutes. Those are left out, so charts show a short gap.
- Only one app should talk to the inverter over Modbus at a time.
- Outages and bushfire warnings cover Queensland only. Plan comparison leaves out controlled load and demand charges.
- Bluetooth in a Proxmox LXC needs a one-time set-up on the Proxmox host (see the README).
- Windows 10 isn't supported.

[Unreleased]: https://github.com/KlemmyDev/WattsMyPower/commits/main
