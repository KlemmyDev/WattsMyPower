# Collector feed protocol (v1)

The collector is the only thing that talks to the inverters. It stores what it reads, **uninterpreted**:
raw 16-bit register words by register address (as printed in the maker's docs), one row per device
per poll, tagged with the driver that read it. The API follows this feed and does all interpretation
(scaling, signs, which register means what, merging the two systems) with its decoder for that driver,
so a mapping fix can be re-applied to history with `python -m app reprocess`.

## Devices

There are two roles: `hybrid`, the inverter with the battery and the grid meter (required), and `pv2`, a
second, AC-coupled solar inverter (optional). Each is read by a driver, picked with `INVERTER_DRIVER` /
`PV2_DRIVER`; a driver id is `<brand>.<model family>`, and the API needs a decoder with the same id.

| Driver          | Role     | What                                        | Input ranges read every poll (start, count)      | Read every 6 h ("info")                                    |
|-----------------|----------|---------------------------------------------|--------------------------------------------------|------------------------------------------------------------|
| `sungrow.sh_rs` | `hybrid` | Sungrow SH-RS/RT via WiNet-S, Modbus TCP     | (5008, 29), (13000, 41), (13041, 2), (13045, 3) | input (4990, 10), (5000, 3), (5639, 1); holding (13059, 1) |
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
  {"version": 1, "poll_interval": 60, "started_at": 1790850000, "oldest_ts": 1759310000, "latest_ts": 1790852400,
   "devices": {"hybrid": {"host": "192.168.0.244", "driver": "sungrow.sh_rs", "last_success": 1790852400.2, "error": null,
                          "info": {"input": {"4990": 16691, "5000": 3597}, "holding": {"13059": 50}}},
               "pv2": {"host": "192.168.0.10", "driver": "sungrow.sg_d", "last_success": 1790852400.9, "error": null, "info": {"input": {}}}}}
  ```
  `info` holds the most recent info registers read. `pv2` is absent when no second inverter is configured.
- `GET /healthz` (no token): `{"ok": true, "fresh": <hybrid read within max(120, poll_interval * 6) s>}`.
