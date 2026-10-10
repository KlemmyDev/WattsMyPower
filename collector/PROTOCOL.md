# Collector feed protocol (v1)

The collector is the only thing that talks to the inverters. It stores what it reads, **uninterpreted**:
raw 16-bit register words by register address (as printed in the maker's docs), one row per device
per poll, tagged with the driver that read it. The API follows this feed and does all interpretation
(scaling, signs, which register means what, merging the two systems) with its decoder for that driver,
so a mapping fix can be re-applied to history with `python -m app reprocess`.

## Devices

There are two roles: `hybrid`, the inverter with the battery and the grid meter (required), and `pv2`, a
second, AC-coupled solar inverter (optional). Each is read by a driver; a driver id is
`<brand>.<model family>`, and the API needs a decoder with the same id.

The devices are stored in the collector's database (table `devices`, one per role) and connected from
the dashboard (Manage → Integrations) through the `/v1/devices` endpoints below. A collector that
starts with a database from before that copies `INVERTER_HOST` / `PV2_HOST` (with their `_DRIVER`,
`_PORT`, `_UNIT` and `PV2_BEHIND_METER`) into it, once; after that the environment's devices are no
longer read. Changes take effect from the next poll, without a restart.

| Driver          | Role     | What                                        | Input ranges read every poll (start, count)      | Read every 6 h ("info")                                    |
|-----------------|----------|---------------------------------------------|--------------------------------------------------|------------------------------------------------------------|
| `sungrow.sh_rs` | `hybrid` | Sungrow SH hybrids (RS, RT, T, K, MG-RL), Modbus TCP | (5008, 29), (13000, 41), (13041, 2), (13045, 3) | input (4990, 10), (5000, 3), (5639, 1); holding (13059, 1) |
| `sungrow.sg_d`  | `pv2`    | Sungrow SG-D via its encrypted Wi-Fi dongle | (5000, 9), (5011, 8), (5031, 2)                  | — (5000-5008 already carry type, nominal, hours)           |

If a range is rejected by the device, the collector falls back to reading its registers one at a time;
words it still can't read are left out. A poll writes the rows for all devices that answered in one
transaction, with the same `ts`, so readers never see half a poll.

## Rows

```json
{
  "ts": 1790852400,
  "device": "hybrid",
  "driver": "sungrow.sh_rs",
  "input": {"5008": 312, "5017": 4120, "5018": 0, "13045": 432},
  "holding": {"13059": 50}
}
```

- `ts`: unix seconds when the poll started (shared by every device in that poll).
- `device`: the role; `driver`: which driver read it, so history stays decodable after an inverter is swapped.
- `input` / `holding`: register address (as a string) -> raw unsigned 16-bit word. Multi-word values are
  just consecutive addresses. `holding` is present only when holding registers were read. Info registers
  appear in a row on the polls where they were read (on start and every 6 h).

## HTTP (`COLLECTOR_TOKEN` required as `Authorization: Bearer <token>` on `/v1/*`)

- `GET /v1/readings?since=<ts>&limit=<n>&wait=<s>`: rows with `ts > since`, oldest first, ordered by
  `(ts, device)`, at most `limit` (default 1000, max 5000) but never splitting a poll. If there are none and
  `wait` > 0 (max 30), hold the request until the next poll lands or `wait` seconds pass.
  Response: `{"readings": [...], "more": true|false}` (`more`: there are further rows after these).
- `GET /v1/status`:
  ```json
  {"version": 1, "poll_interval": 60, "started_at": 1790850000, "next_poll": 1790852460.0,
   "oldest_ts": 1759310000, "latest_ts": 1790852400,
   "devices": {"hybrid": {"host": "192.168.0.244", "driver": "sungrow.sh_rs", "last_success": 1790852400.2, "error": null,
                          "info": {"input": {"4990": 16691, "5000": 3597}, "holding": {"13059": 50}}},
               "pv2": {"host": "192.168.0.10", "driver": "sungrow.sg_d", "last_success": 1790852400.9, "error": null, "info": {"input": {}}}}}
  ```
  `next_poll` is when the next poll starts: a poll interval after the last one started, or the backoff after
  a failed one. It's null while no hybrid is connected, and in the past while a poll is under way.
  `info` holds the most recent info registers read. `pv2` is absent when no second inverter is connected,
  and `devices` is empty until a hybrid is (nothing is read without one). Each device also reports its
  `port`, `unit` and `settings`.
- `GET /v1/devices`: `{"devices": [{"role", "driver", "host", "port", "unit", "settings", "added_at"}],
  "drivers": {"sungrow.sh_rs": "hybrid", ...}}`. `settings` belong to the API (e.g. `behind_meter` for a
  `pv2`): the collector stores them as they are.
- `PUT /v1/devices/<role>` with `{"driver", "host", "port"?, "unit"?, "settings"?, "check"?}`: connect a
  device in that role, replacing any there. Unless `check` is false (or only `settings` changed), the device
  must answer its driver's probe first (422 if not). Returns `{"device": {...}, "input": {address: word}}`,
  the words the probe read (the identity registers: type code, nominal power, serial).
- `DELETE /v1/devices/<role>`: `{"removed": true|false}`.
- `GET /v1/devices/<role>/holding`: the device's settings registers, read now: `{"holding": {"13050": 0, ...}}`.
  Only a device whose reader can change settings has them (`sungrow.sh_rs`: the battery settings, holding
  (13050, 10) and (33047, 2)); others answer 409, a role with no device 404, a device that doesn't answer 502.
- `PUT /v1/devices/<role>/holding` with `{"words": [[13051, 204], [13050, 2]]}` (1 to 10 pairs): write each
  register in order, one request each (function 0x06), then read them all back: `{"holding": {...}}` (empty if
  that read failed). Only the addresses the reader allows (`sungrow.sh_rs`: 13050-13052, 13058, 13059) are
  written; anything else is 422 before a word is sent. A write the device refuses is 422 (those before it stay
  written). The collector doesn't interpret what it writes: the API's driver decides that
  (app/features/inverters/sungrow/sh_control.py). A WiNet-S2 may take a while to show the change on reads.
- `POST /v1/scan` with `{"network": "192.168.1.0/24"}` (private, /22 or smaller): start looking for inverters.
  422 for a network that can't be scanned, 409 while a scan runs. `GET /v1/scan` reports progress:
  `{"running", "network", "started_at", "finished_at", "checked", "total", "error", "found": [{"host", "port",
  "driver", "input", "connected"?}]}`. `found` lists every address with Modbus TCP port 502 open: `driver`
  is the first reader whose probe recognised it (null if none did), with the words its probe read; addresses
  of connected devices are marked `connected` and not probed.
- `GET /v1/storage`: the database measured, for the dashboard's Manage → Data. Reads every page, so it
  can take a few seconds on a large database. `{"path", "files": {"database", "wal", "shm"}, "page_size",
  "pages", "free_pages", "schema_version", "sqlite_version", "journal_mode", "measured", "retention_days",
  "tables": [{"name", "rows", "data_bytes", "index_bytes", "payload_bytes", "unused_bytes", "pages", "oldest",
  "newest", "recent_rows", "parts": [{"label", "rows", "share", "bytes"}], "columns": [{"name", "type"}],
  "indexes": [{"name", "bytes"}]}]}`. Sizes are bytes; `measured` is false (and the per-table sizes null) when
  SQLite was built without `dbstat`. `oldest` / `newest` / `recent_rows` (rows in the last 7 days) are for
  dated tables; `parts` breaks `readings` down by device.
- `GET /v1/backup`: a copy of the database (`application/vnd.sqlite3`, with its `Content-Length`), for the
  dashboard's backups (Manage → Data). It's made with SQLite's online backup, so it's consistent while polls
  keep writing, and it's one file (no `-wal` to go with it). The copy is made before the first byte is sent, which
  takes a while on a large database, and deleted once it's sent. 409 while another is being made or sent.
- `GET /healthz` (no token): `{"ok": true, "fresh": <hybrid read within max(120, poll_interval * 6) s>}`.
