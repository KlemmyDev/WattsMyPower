# Developers: API keys

Other apps on your home network can read your energy data with an **API key**. The first one is the Home Hub (a family
dashboard on the fridge). A key only **reads**: it can't change a rate, a setting or the inverter. You choose what each
key may read.

## Making a key

Open **Settings, then Developers** (you need to be signed in). Name the key, switch on what it may read, and choose
**Make a key**. The whole key (`wmp_…`) is shown once. Only a SHA-256 hash is kept, with the key's first characters to
tell keys apart, its name, when it was made and when it was last used. Removing a key stops it working at once.

| Permission | What it lets the key read |
| --- | --- |
| `live:read` | Solar, battery, home and grid power right now, and today's totals so far (`live`, `today`). |
| `history:read` | Every reading and each day's totals, and the CSV download (`history`, `daily`, `export.csv`). |
| `costs:read` | What each day cost and saved, the electricity rates, and the bills (`costs`, `tariff`, `bills`). |
| `forecast:read` | The next day's solar and battery forecast (`forecast`). |
| `insights:read` | Self-sufficiency, battery health, grid use by hour and panel performance (`insights`). |
| `system:read` | The system's size and inverter, the saved settings (the location and the house's street and suburb) and what the database holds (`system`). Off by default. |

Any valid key can call `ping`.

## Using a key

Send it as `Authorization: Bearer wmp_…`. Errors are `{"detail": "…"}`: **401** for no key, a wrong one or a removed
one, **403** for a key without the permission for that route.

```bash
curl -H "Authorization: Bearer wmp_…" http://<this machine>:8080/api/v1/live
```

The key replaces the dashboard's sign-in for these routes only. A key never opens the dashboard's own `/api` routes
(which still need a signed-in browser), and sign-in being turned off (`AUTH=false`) doesn't open `/api/v1`: it always
wants a key.

## Routes

All under `/api/v1`, all `GET`:

- `ping`: the app, the key's name and permissions, whether the inverter is answering, and the time.
- `live`: the latest reading and what goes with it: `snapshot` (`pv_power`, `load_power`, `grid_power` where positive
  is importing, `battery_power` where positive is discharging and negative charging, `battery_soc`, temperatures, and
  today's counters such as `daily_pv`, `daily_import` and `daily_export`), `last_success`, `error`, `off_grid` and so
  on. The system's own details, the app's version and the cars are left out.
- `today`: `{live, costs}` in one answer for a widget. `costs` is today's row from `costs`, and is left out unless the
  key also has `costs:read`.
- `history?start=&end=&points=&fields=`, `daily?start=&end=`, `export.csv?start=&end=&rollup=`: as in the dashboard
  (unix seconds).
- `costs?start=&end=`, `tariff`, `bills`.
- `forecast`, `insights`.
- `system`: `{system, settings, storage}`.

The keys themselves are made and removed through `GET /api/keys`, `POST /api/keys` (`{"name": "Home Hub", "scopes":
["live:read"]}`; leave `scopes` out for the defaults) and `DELETE /api/keys/{id}`, which need a signed-in browser.

Changes are made in `app/features/keys/`; the tests are in `tests/test_api_keys.py`.
