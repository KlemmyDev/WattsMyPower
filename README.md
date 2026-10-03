# WattsMyPower

A self-hosted dashboard for a **Sungrow hybrid inverter and battery** (SH-RS / SH-RT series). It talks to the inverter directly on your home network (Modbus TCP through its WiNet-S dongle), records a reading every minute in a small SQLite database, and serves a live web dashboard: what your solar, battery, home and grid are doing right now, what today has cost and saved, history, a solar and battery forecast, insights, and savings. Nothing goes through Sungrow's cloud, so readings are live rather than delayed.

## What it does

- **Live power flow:** solar, battery, home and grid, updated every minute, drawn as an animated house that follows the weather.
- **Today's cost and savings,** priced at your actual rates (single rate or time of use), split by rate.
- **History:** a calendar-year heatmap; pick any day to see it in 5-minute steps; CSV downloads.
- **Forecast:** the next 24 hours of solar and battery level, from the local weather (Open-Meteo), calibrated to your own system.
- **Insights:** self-sufficiency, battery health and cycles, when you use grid power, and whether your panels are performing as they should.
- **Savings:** this quarter's bill, system payback, and a comparison of every current plan from a retailer against your real usage.
- **A second, older Sungrow inverter** (for example an SG5K-D on an AC-coupled system) can be added, so both systems count.
- Works on desktop and phones.

## What you need

- A Sungrow SH-RS or SH-RT hybrid inverter with a **WiNet-S or WiNet-S2** dongle on your home network. The dashboard finds it by scanning your network; if it can't, you'll need its **IP address** (from your router's list of connected devices, or the iSolarCloud app).
- A **Linux machine on the same network that stays on**: a Proxmox LXC container or VM, a Raspberry Pi, or any Debian or Ubuntu box. The install script sets up Docker on it if needed.
- Optional: a second, older Sungrow inverter with a Wi-Fi dongle (found by the same scan).

## How it fits together

Two services, run together by Docker Compose:

- **The collector** (`wattsmypower-collector`) is the only thing that talks to the inverters. Every poll it stores the raw register values it read, uninterpreted, in `data/collector.db`, and serves them over a token-protected feed ([collector/PROTOCOL.md](collector/PROTOCOL.md)). It rarely changes, so updates to the dashboard leave it recording without a break.
- **The dashboard** (`wattsmypower`) follows that feed and does everything else: decoding the registers, merging a second inverter, readings and rollups (`data/wattsmypower.db`), costs, forecast, insights, savings, sign-in, and the web app. If the way a register is read ever turns out to be wrong, `python -m app reprocess` rebuilds the readings from the collector's raw history.

## Install

1. **Log in to the Linux machine** (for example `ssh root@<machine IP>`, or the Proxmox console).

2. **Run the installer:**

   ```bash
   curl -fsSL https://raw.githubusercontent.com/KlemmyDev/WattsMyPower/main/install.sh | bash
   ```

   (On a minimal system without curl, run `apt install -y curl` first. Prefix commands with `sudo` if you're not logged in as root.)

   It downloads WattsMyPower into a `wattsmypower` folder where you run it (installing git first if it's missing, asking first). To use another folder, put `WMP_DIR=/opt/wattsmypower` before `bash`. If you'd rather read the script before running it, download it, look it over, then run it:

   ```bash
   curl -fsSLO https://raw.githubusercontent.com/KlemmyDev/WattsMyPower/main/install.sh
   bash install.sh
   ```

   It installs Docker if it's missing (asking first), and sets Docker to start at boot so the dashboard comes back by itself after a restart. Then it asks:
   - the total size of your solar panels in kW
   - your time zone, and the port for the dashboard (8080 unless you change it)

   It saves your answers to `.env`, builds and starts the app, waits until it's responding, and prints its address, for example `http://192.168.1.50:8080`.

3. **Open that address** in a browser on any device on your network. The first visit asks you to create the dashboard's account (a username and password); after that, every browser signs in with it. Then finish setting up:
   - **Settings → Integrations → Connect an inverter:** scan your network and connect your hybrid (and a second inverter if you have one). Readings start within a minute.
   - **Settings → Tariffs:** your electricity rates. Use **Find your plan** to load them from Energy Made Easy, or enter them by hand.
   - **Settings → Integrations → Change location:** your suburb, for the weather forecast.
   - **Savings:** what your system cost, for the payback estimate.

If you're running Docker inside an unprivileged Proxmox LXC container, first turn on `nesting=1` in the container's **Options → Features**.

## Everyday use

Run these from the `wattsmypower` folder:

| Command | What it does |
|---|---|
| `bash install.sh` | update to the latest version (backs up both databases first) |
| `bash install.sh --configure` | change your settings (time zone, port) and restart. Inverters are changed in **Settings → Integrations**, and the array size and battery in **Settings → System**. |
| `bash start.sh` | start it, and Docker if needed, without updating or rebuilding |
| `docker compose stop` | stop it |
| `docker compose logs -f --tail=50` | watch the logs (add `collector` or `wattsmypower` for one service) |
| `docker compose exec wattsmypower python -m app reprocess [YYYY-MM-DD]` | rebuild readings from the collector's raw registers (from a date, or everything it holds), after a fix to how they're decoded |
| `bash install.sh --yes` | install or update without questions; settings can be passed in, e.g. `TZ=Australia/Perth bash install.sh --yes`. On a first install, `PV_KW=10` sets the array size and `INVERTER_HOST=192.168.1.20` connects the inverter, without the dashboard. |

**Updating** pulls the latest version, backs up both databases to `data/backups/` without stopping the app (the newest 5 are kept), rebuilds, waits until the app responds, and removes the old image. Your data (`data/`) and settings (`.env`) are never overwritten. If a setting the app is using isn't in `.env` yet (because it came from an older version's default), it's written into `.env` with the value in use, so updates never change your setup. If you've edited any of the app's files, it stops rather than overwrite them.

**Moving an existing install to a git checkout** (for example one copied over as a zip): run the install command above from another folder. It finds the running copy, offers to move its `data/` and `.env` across, and stops it. The old folder is left as it was, so it doubles as a backup.

**Your data** lives in `data/wattsmypower.db`. With the default settings it grows to about 20 MB over the first 90 days, then by about 18 MB a year. To restore a backup: `docker compose stop`, copy the backup over `data/wattsmypower.db`, then `docker compose start`.

> **Sign-in.** The dashboard and its API need you to sign in, with the account created on the first visit. Sessions last 30 days in each browser; **Settings → Account** changes the password (which signs out every other browser) or signs out. Forgot it? `docker compose exec wattsmypower python -m app reset-account` removes the account, and the next visit asks for a new one. If something in front of the dashboard already handles sign-in (a reverse proxy with authentication), you can set `AUTH=false`. Either way, keep it on your home network rather than port-forwarding it: it's served over plain HTTP.

> **Only one app should talk to the inverter.** The WiNet-S handles several Modbus clients at once badly. Don't point Home Assistant, SunGather or a second copy of WattsMyPower at it at the same time.

## Pages in detail

The dashboard implements the "Energy Dashboard v5" design from Claude Design: a dark theme with Nunito headings and Geist type. Pages have their own addresses (`/history`, `/settings/tariffs`), and links from the old dashboard (`#/history`) still work. The header has the page navigation (a white pill slides to the current page), the live status with the date and time, and a gear for Settings. The Tesla page only appears in the navigation once a Tesla is connected.

- **Overview:** a greeting for the time of day, then a wide power-flow scene: an isometric house with animated flows between solar, grid, battery and home, with live readings in pills at the left and right edges. The scene follows the current hour's weather from the forecast: sunny, cloudy, rain or storm by day, and a night sky after dark with clouds or rain if it's cloudy or wet. Live updates arrive every minute (server-sent events).
- **Mini power flow:** on every page except Overview, a small live bar floats at the bottom. It shows solar, home and grid, with animated flow direction, plus battery charge and whether it's charging or discharging. Select it to open Overview.
- **Today so far:** cost today and saved today as two headline figures, a bar splitting what you pay from what solar and the battery cover, and a table by rate (cheapest first) of energy from the grid, cost and saving, plus the supply charge and solar credit. A rate that hasn't started yet today shows when it starts. The chip in the corner opens the rates in Settings.
- **Battery, last 6 hours:** a chart along the bottom of the battery card, blue while charging or idle and amber while discharging, with the backup reserve as a dashed line. Hover for the time, level and rate.
- **Battery card:** when the battery is discharging, the pill and charge ring turn amber and the ring pulses. The estimate switches to time until the backup reserve, how much of the home the battery is covering, and when solar is forecast to start charging it again.
- **Next 24 hours:** a one-line summary (when the battery fills, when solar drops below home use, whether the battery reaches its reserve, tomorrow morning's weather), weather every 3 hours, a chart of forecast solar, home use and battery level with markers for "Full" and "Reserve", and totals for solar, use, grid import and expected cost.
- **History:** a calendar year as a heatmap (January to December, with arrows to step back through earlier years), coloured by solar, self-sufficiency, grid import or savings, with totals for the year. On phones it turns on its side: a row per week with the days of the week across the top. Select a day (or step with the arrows) to see its solar, home use and battery level in 5-minute steps, its totals, and a CSV download for that day.
- **Forecast:** solar, battery full time, lowest overnight battery, tomorrow morning's weather, and an hour-by-hour strip.
- **Insights:** four headline figures (30-day self-sufficiency and share of solar used at home, battery cycles, lifetime CO₂ avoided), self-sufficiency by month for the last 12 months, battery health (state of health reported by the battery, depth of discharge, round-trip efficiency, time at full charge), a heatmap of grid import by hour and month, and solar performance: each of the last 30 days' output compared with what the weather allowed, flagging clear days more than 10% below expected. Sections fill in as history builds up; the lifetime figures come from the inverter's own counters, so they're right from the first reading.
- **Savings:** this quarter's bill (so far, and estimated for the whole quarter from your average full day over the last 30 days, with what it would be without solar and the battery); system payback (enter what the system cost on the card; savings since install are estimated from the inverter's lifetime counters at today's rates, and the payoff date from your average monthly saving); a plan comparison that prices a year of your actual usage on every current plan from a retailer you choose; and the cost to drive 100 km from solar, the grid, or petrol.
- **Tesla:** "not connected" state and the connection screen. Tesla sign-in needs a Tesla Fleet API app, which isn't set up yet.
- **Settings:** system details read from the inverter (model, serial, battery, backup reserve, grid connection) and the ones it can't report (the solar array's size, and optionally the battery's capacity, a backup reserve to fall back on, and its maximum charge and discharge rate), electricity rates, and connected services, including the weather location. Change the weather location by searching for a suburb, town or address (OpenStreetMap's Nominatim service); only the suburb-level name and its coordinates are saved, never a street address. Coordinates can still be entered directly, and get a place name looked up automatically. The Forecast page shows which place the outlook is for.

### Tariffs

Settings → Tariffs takes either a **single rate** or **time of use**. Time of use has up to six named rates (peak, shoulder, off-peak, and so on). Each rate has a price and one or more time windows, and each window applies every day, on weekdays only, or on weekends only. One rate is marked for **all other times**. Windows can cross midnight (21:00 to 07:00). Overlapping windows are rejected with a message naming the clash. A 24-hour timeline shows weekdays and weekends before you save. Feed-in and the daily supply charge are flat.

**Find your plan.** Above the rates, enter your postcode and retailer to search the plans retailers currently publish to [Energy Made Easy](https://www.energymadeeasy.gov.au). The data comes from the AER's public Consumer Data Right product reference data APIs at `cdr.energymadeeasy.gov.au`; no account or key is needed. Results show each plan's rate type and prices, so plans with the same name can be told apart. Plans with controlled load are hidden unless you tick the box. Choosing **Use this plan** fills in the rates form for you to check; nothing is saved until you select **Save rates**. Imported prices have 10% GST added (CDR prices exclude GST; feed-in doesn't attract GST). A note lists anything that couldn't be carried over:
- seasonal rates (the current season is used)
- stepped rates (the first step is used)
- demand charges
- controlled load
- conditional discounts
- time-varying feed-in (the highest rate is used)
- government feed-in schemes like the Queensland Solar Bonus Scheme, which only apply to customers already on them

Plan lists are cached for 6 hours and plan details for a day. The retailer list is `app/features/plans/retailers.json`, taken from the AER's "Energy Retailer Base URIs" PDF (January 2026) and limited to retailers that currently publish electricity plans. Refresh it when the AER updates that list.

Costs are worked out on the server for every 5-minute reading, so each kWh is priced at the rate in force at that moment. Each day's totals are then scaled to match the inverter's own daily import and export counters. The whole history is priced with the current tariff, so saving new rates reprices past days too. "Today so far" shows the day's bill so far: grid usage (per rate on time of use), plus the daily supply charge, minus the feed-in credit, giving a cost (or credit) for today. History's "Saved" uses the same per-day figures.

Register map and quirks come from [berndverhofstadt/sungrow-poc](https://github.com/berndverhofstadt/sungrow-poc) (MIT).

## Configuration

All settings are environment variables (see `.env.example`):

| Variable | Default | |
|---|---|---|
| `PORT` | `8080` | Port the dashboard is served on |
| `COLLECTOR_TOKEN` | *(generated)* | Secret the dashboard uses to read the collector's feed. `install.sh` creates one in `.env`. |
| `COLLECTOR_WRITES` | `true` | Whether the dashboard may change what the collector reads (connect, remove or scan for inverters). Set `false` on a dashboard following another server's collector, such as one you're developing on, so it can't disturb that system. |
| `COLLECTOR_PORT` | `8081` | Port the collector's feed is published on, so a dashboard running elsewhere (for example while developing) can follow it. Needs the token. |
| `COLLECTOR_RETENTION_DAYS` | `365` | Keep the collector's raw registers this many days (what `reprocess` can rebuild from). `0` = keep everything. |
| `INVERTER_HOST`, `INVERTER_DRIVER`, `INVERTER_PORT`, `INVERTER_UNIT` | *(empty)*, `sungrow.sh_rs`, `502`, `1` | **Only read once:** inverters are connected in **Settings → Integrations** and stored in `data/collector.db`. The first time the collector starts with a database from before that, it moves the hybrid set here into it; after that these are ignored. |
| `PV2_HOST`, `PV2_DRIVER`, `PV2_PORT`, `PV2_UNIT` | *(empty)*, `sungrow.sg_d`, `502`, `1` | The same, for a second, AC-coupled solar inverter. |
| `PV2_BEHIND_METER` | `true` | Where a second system connects, unless it's set in **Settings → Integrations**. `true`: on the house side of the hybrid's meter (the usual setup), so its output is added to home use. `false`: outside the hybrid's meter, so its output is added to export. |
| `POLL_INTERVAL` | `60` | Seconds between reads. 60 is also the minimum: the WiNet-S2 dislikes aggressive polling and only refreshes most registers every ~30–60s anyway. |
| `RAW_RETENTION_DAYS` | `90` | Keep minute-by-minute readings for N days, then delete them. 5-minute averages are kept forever, so older periods still chart at 5-minute resolution. `0` = keep everything. |
| `TZ` | `Australia/Brisbane` | Sets where "today" and the daily totals roll over |
| `PV_KW` | `6.6` | **Only read once:** the solar array size is set in **Settings → System** and stored in `data/wattsmypower.db`. The first time the dashboard starts with a database from before that, it moves the value set here into it (on a new install, `PV_KW=10 bash install.sh --yes` sets it); after that this is ignored. |
| `BATTERY_KWH`, `BATTERY_RESERVE`, `BATTERY_MAX_KW` | `0`, `10`, `5` | The same, for the battery's capacity (`0` = read it from the inverter), the backup reserve used when the inverter doesn't report one, and its maximum charge and discharge rate in kW. |
| `IMPORT_RATE` / `FEED_IN_RATE` / `SUPPLY_CHARGE` | `0.32` / `0.05` / `1.05` | Starting single-rate tariff in AUD, used until you save rates in **Settings → Tariffs**. |
| `LATITUDE` / `LONGITUDE` | Brisbane CBD | Starting forecast location. **Set your own in Settings → Integrations → Change location.** |
| `FORECAST` | `true` | Set to `false` to turn off the Open-Meteo forecast |
| `AUTH` | `true` | Require signing in. Set to `false` only if a reverse proxy in front of it already handles sign-in. |

### Supported inverters

Each inverter is handled by a driver: one for the hybrid (with the battery and grid meter), and one for an optional second solar inverter. **Settings → Integrations** picks the driver when it finds an inverter, or lets you choose one when you enter an address yourself. So far:

| Driver | Role | Inverters | Connection |
|---|---|---|---|
| `sungrow.sh_rs` | hybrid | Sungrow SH-RS and SH-RT (tested on an SH5.0RS) | Modbus TCP through the WiNet-S / WiNet-S2 dongle |
| `sungrow.sg_d` | second inverter | Sungrow SG-D string inverters (tested on an SG5K-D) | Sungrow's encrypted Modbus through the Wi-Fi dongle |

A driver has two halves with the same id. The collector's reader (`collector/devices/<brand>/<model>.py`, listed in `collector/devices/drivers.py`) only fetches raw registers. The dashboard's decoder (`app/features/inverters/<brand>/<model>.py`, listed in `app/features/inverters/drivers.py`) turns them into readings in the shape described in `app/features/inverters/types.py`. Every stored reading records which driver read it, so swapping inverters later doesn't confuse the history. To add an inverter, write both halves and add them to the two lists. Everything past the decoder (merging, costs, the dashboard) works unchanged.

### Connecting inverters

**Settings → Integrations → Connect an inverter** scans your home network (a /24 by default, up to a /22) for anything answering on Modbus TCP port 502, then asks each address what it is: plain Modbus for a WiNet-S hybrid, then Sungrow's encrypted handshake for an older Wi-Fi dongle. Each find shows its model and serial number, and connects with one click. You can also enter an address yourself, and connect an inverter that isn't answering (a string inverter asleep after dark) anyway.

The collector does the scanning and stores the connected inverters in `data/collector.db`, since it's the only part that talks to them and keeps recording while the dashboard updates. Changes apply from its next poll, without a restart. Inverters already connected aren't probed during a scan, because the WiNet-S2 copes badly with a second Modbus client. Installs from before this kept their inverters in `.env` (`INVERTER_HOST`, `PV2_HOST`): the first time the updated collector starts, it moves them into its database, once, and they're managed in the dashboard from then on.

### A second solar system (AC-coupled)

If you also have an older Sungrow string inverter (for example an SG5K-D), the hybrid can't read it, so none of its output counts as solar. Connect it in **Settings → Integrations** as a second solar inverter and it's read every poll alongside the hybrid. Solar becomes both systems together. What else changes depends on where it's wired, which you choose when connecting it (and can change there later):

- **Behind the hybrid's meter** (`true`, the default and the usual setup): the meter already counts its surplus as export, and the hybrid sees its output as reduced (even negative) home use, so it's added back to home use.
- **Outside the hybrid's meter** (`false`): the hybrid's meter never sees it, so all of its output is exported on top of what the meter measured. Export, feed-in credit and "solar used at home" include it; home use is unchanged.

To check, run a known load (an EV charging, an oven) and see whether home use on the dashboard includes it. Or compare a day's export in your retailer's app with the dashboard's.

The hybrid's own figures are stored too (`pv1_power`, `daily_pv1`, `total_pv1`, `load_hybrid`, `grid_hybrid`, `daily_export1`), alongside the second system's (`pv2_power`, `daily_pv2`, `total_pv2`, `pv2_temp`).

These older dongles accept Modbus TCP on port 502 but only answer Sungrow's encrypted variant (a daily key from the dongle, then AES on every frame); the collector handles that (`collector/devices/sungrow/dongle.py`). If the second inverter stops answering, the hybrid keeps polling normally: its last values are carried for a couple of minutes, then its output counts as zero (they power down after dark) while today's yield stands. System payback uses the hybrid's own lifetime solar counter, because a second system's lifetime counter can predate the hybrid's meter.

### How plan comparison works

Grid import for every 5-minute slot of a weekday and a weekend day is averaged over complete days (at least 80% of readings) from the last year, scaled to the inverter's daily counters. Each plan's rates are applied slot by slot, weighting weekdays and weekends 5:2, plus a year of supply charge, minus a year of feed-in at the plan's rate. It needs at least 3 complete days. Plans with controlled load or demand charges are left out. Plans whose conversion had to simplify something (a feed-in rate that changes through the day, stepped or seasonal rates) are marked **Approximate** and never recommended as the cheapest. Duplicate listings of the same plan for different network areas are shown once.

### How solar performance works

Past hourly radiation for your location comes from Open-Meteo (the last 92 days, refreshed every 6 hours). Output per kWh/m² of radiation is fitted on those days, using only hours when the inverter wasn't at its limit, and each hour's expected output is capped at the highest output seen. So 100% means "as well as this system usually does in that weather", and a gradual decline shows up as the fit window moves on. Days are only judged when at least 80% of their daylight hours have readings. Only clear days are flagged: on overcast days the modelled radiation is too uncertain to judge.

CO₂ avoided uses 0.68 kg per kWh, the average Australian grid emissions factor.

### How the forecast works

Hourly weather comes from [Open-Meteo](https://open-meteo.com) (free, no API key), fetched at most every 30 minutes. Solar output is modelled from forecast sunlight and calibrated against what your inverter actually produced over the last week, so panel direction, shading and clipping are learned automatically. The first calibration happens after about 30 minutes of daylight data. Home use is what the house typically uses in each hour of the day over the last two weeks. The battery is then projected forward hour by hour from its current charge.

Both are fitted day by day and then combined in a way one odd day can't skew: solar takes the median day's calibration, and home use drops the highest and lowest fifth of days for each hour before averaging. Readings no home system could produce, such as a reply decrypted with a stale key or a 32-bit value read across an update, are dropped when they're decoded, so they never reach the history or the forecast.

The inverter's solar reading only covers panels connected to the Sungrow. If you also have an AC-coupled system, connect it as a second inverter (see below) so it's included; otherwise it shows up as lower (sometimes negative) home use.

If the inverter stops responding, the poller backs off exponentially (up to 5 min) and the dashboard shows the error.

## Sign conventions

Power values are positive when they flow **into the house**:

| Field | Positive | Negative |
|---|---|---|
| `grid_power` | importing | exporting |
| `battery_power` | discharging | charging |
| `load_power` | house consumption | the inverter's load side is *supplying* power (power-flow bit 7, e.g. a second AC-coupled solar system) |

## Querying history

The database is plain SQLite with two tables of identical columns, keyed on unix-seconds `ts`:

- `samples`: one row per poll
- `samples_5m`: 5-minute rollups (averages for power, maximums for energy counters), used for long ranges

```bash
sqlite3 data/wattsmypower.db \
  "SELECT datetime(ts,'unixepoch','localtime'), pv_power, battery_soc FROM samples ORDER BY ts DESC LIMIT 10"
```

HTTP API (every `/api` endpoint except `/api/auth/*` needs a signed-in session cookie; `/healthz` is open):

| Endpoint | |
|---|---|
| `GET /api/auth/session` | whether this browser is signed in, and whether an account still needs creating |
| `POST /api/auth/setup`, `POST /api/auth/login`, `POST /api/auth/logout` | create the account (first run only), sign in, sign out |
| `PUT /api/auth/password` | change the password (signs out other browsers) |
| `GET /api/live` | latest snapshot, system details, and whether readings are arriving |
| `GET /api/stream` | server-sent events, one message per poll |
| `GET /api/history?start=&end=&points=&fields=` | time-bucketed columnar series (unix seconds) |
| `GET /api/daily?start=&end=` | per-day kWh totals |
| `GET /api/export.csv?start=&end=&rollup=` | CSV download |
| `GET /api/forecast` | next ~36 h of hourly solar, home use and battery forecast (`null` if unavailable) |
| `GET /api/insights` | figures for the Insights page (cached for 10 minutes; lifetime counters are always current) |
| `GET /api/savings` | this quarter's bill (so far and estimated) and system payback |
| `GET /api/plans/compare?brand=&postcode=` | a year of your usage priced on each of a retailer's current plans, cheapest first |
| `GET /api/tariff`, `PUT /api/tariff` | read or replace the tariff (JSON; validated, including overlapping windows) |
| `GET /api/costs?start=&end=` | per-day import, export, cost, and savings, split by rate |
| `GET /api/plans/brands` | retailers that publish plans |
| `GET /api/plans/search?brand=&postcode=&q=` | a retailer's current residential electricity plans for a postcode, with prices incl. GST |
| `GET /api/plans/tariff?brand=&plan=` | one plan converted to a tariff, plus notes (not saved) |
| `GET /api/settings`, `PUT /api/settings` | read or change the forecast location (coordinates and place name) and system cost |
| `GET /api/geocode?q=` | suburbs, towns and addresses matching q (OpenStreetMap), for choosing the forecast location |
| `GET /api/stats`, `GET /healthz` | row counts / DB size, health |

## Local development

Backend (`uv sync --extra collector` gets Python 3.12 and everything both services need, from uv.lock; install uv: https://docs.astral.sh/uv/).

**The dashboard API against your server's collector**, with real data and no second copy talking to the inverters (they cope badly with two clients). Use the `COLLECTOR_TOKEN` from the server's `.env`:

```bash
COLLECTOR_URL=http://<server IP>:8081 COLLECTOR_TOKEN=<token> DB_PATH=./data/local.db uv run uvicorn app.main:app --port 8080
```

It builds its own database from the collector's raw history (whatever the collector holds), then follows it live. Its settings, rates and account are its own, so changes there never touch the server. `python -m app reprocess` with the same variables rebuilds it after changing how registers are decoded.

**Without the server:** `MOCK=1 DB_PATH=./data/mock.db uv run uvicorn app.main:app --port 8080` generates 14 days of readings and keeps simulating, with no collector. Or run a simulated collector and follow it, to exercise the whole pipeline: `COLLECTOR_MOCK=1 COLLECTOR_TOKEN=dev COLLECTOR_DB_PATH=./data/collector.db uv run python -m collector`, then the API with `COLLECTOR_URL=http://127.0.0.1:8081 COLLECTOR_TOKEN=dev`. Keep mock data in its own files so it never mixes with real data.

Checks (`uv run …`): `pytest` (tests), `ruff check` and `ruff format` (lint and format), `mypy` (types).

Dashboard (React, TanStack Start in SPA mode, Tailwind; see [web/README.md](web/README.md)):

```bash
cd web && npm install
echo "API_TARGET=http://127.0.0.1:8080" > .env.local
npm run dev
```

Then open `http://localhost:5174`. `/api` is proxied to `API_TARGET`, and edits show up straight away. `npm run build` writes the production build to `web/dist/client/`, which the backend serves at `/` (the Docker image builds it for you).

**Working on just the dashboard against your running instance.** To try frontend changes with live data, without a second copy of the app polling your inverters (they cope badly with two clients), set `API_TARGET=http://<server IP>:8080` and sign in with your usual account. API and backend changes still need a deploy. While `API_TARGET` isn't a local address, saving rates, location or system cost is refused unless you also set `API_ALLOW_WRITES=1`, which saves to the live service.

## Layout

```
collector/              the collector service: reads the inverters, stores raw registers, serves the feed
  PROTOCOL.md           the feed's contract: devices, register ranges, rows, endpoints
  devices/              the device interface, the reader registry (drivers.py), Modbus helpers, and a
                        package per brand with a reader per model family (sungrow/sh_rs.py, sungrow/sg_d.py)
app/
  main.py               the FastAPI app (create_app), its middleware and routers
  container.py          builds every service once from the config; routers get them via app/dependencies.py
  __main__.py           maintenance commands (python -m app reset-account | reprocess)
  core/                 shared infrastructure
    config.py           settings from environment variables
    database.py         SQLite connections and migrations
    schema.py           every table, and the versioned migrations that create and change them
    http.py, cache.py   outbound JSON requests, and a TTL cache for slow lookups
    spa.py              serves the built dashboard
  features/<name>/      one module per capability, each with its router, service and SQL:
    inverters/          what the readings mean: the driver interface (types.py) and registry
                        (drivers.py), merging the two systems (merge.py), and a package per brand
                        with a module per model family (sungrow/sh_rs.py, sungrow/sg_d.py)
    live/               following the collector's feed (ingest.py), turning raw rows into readings
                        (transform.py), reprocessing, mock mode, and the live event stream
    readings/           samples and 5-minute rollups: history, daily totals, CSV export
    tariffs/            tariff model and validation, the saved tariff, and time-of-use cost maths
    settings/           forecast location (and place name) and system cost; OpenStreetMap place search
    forecast/           Open-Meteo forecast, self-calibration, battery projection
    insights/           Insights page figures, including solar performance against past weather
    savings/            quarterly bill, payback, plan comparison
    plans/              Energy Made Easy / CDR plan search and plan-to-tariff conversion (retailers.json)
    auth/               sign-in: the household account, sessions, and the /api guard
tests/                  pytest suite
web/                    dashboard: React + TanStack Start (SPA mode) + TanStack Query + Tailwind; see web/README.md
install.sh              install or update with Docker (see above)
start.sh                start it, and Docker if needed
```
