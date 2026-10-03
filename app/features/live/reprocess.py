"""
Rebuild the readings from the collector's raw registers, after a change to how they're decoded
(`python -m app reprocess`). Only covers what the collector still holds (its retention period).
"""

from __future__ import annotations

import logging
from typing import Any

from app.core.config import Config
from app.core.database import Database
from app.core.schema import ROLLUP
from app.features.live.client import Feed
from app.features.live.ingest import BATCH, save_cursor
from app.features.live.transform import Freeze, Pv2Carry, behind_meter, snapshots
from app.features.readings.repository import ReadingsRepository

log = logging.getLogger(__name__)


def reprocess(config: Config, db: Database, client: Feed, since: int | None = None) -> dict[str, Any]:
    """Replace readings from `since` (default: the oldest raw data the collector has) with freshly decoded ones."""
    status = client.status()
    oldest = status.get("oldest_ts")
    if oldest is None:
        return {"polls": 0, "frozen": 0, "from": None, "to": None}
    start = max(int(oldest), since or 0) // ROLLUP * ROLLUP  # whole rollup buckets
    readings = ReadingsRepository(db, config.poll_interval, config.raw_retention_days)
    pv2 = (status.get("devices") or {}).get("pv2")
    has_pv2 = pv2 is not None
    behind = behind_meter(pv2, config.pv2_behind_meter)
    carry, freeze = Pv2Carry(), Freeze()
    conn = db.connect()
    try:
        conn.execute("DELETE FROM samples WHERE ts >= ?", (start,))
        conn.execute("DELETE FROM samples_5m WHERE ts >= ?", (start,))
        conn.commit()
        cursor, polls, newest = start - 1, 0, None
        while True:
            rows, more = client.readings(cursor, BATCH)
            if not rows:
                break
            snaps = snapshots(
                rows,
                has_pv2=has_pv2,
                behind_meter=behind,
                poll_interval=config.poll_interval,
                carry=carry,
                freeze=freeze,
            )
            readings.insert_many(conn, snaps)
            polls += len(snaps)
            cursor = newest = max(int(r["ts"]) for r in rows)
            log.info("Reprocessed %d polls (to %s)", polls, newest)
            if not more:
                break
        if newest is not None:
            save_cursor(conn, newest)
    finally:
        conn.close()
    return {"polls": polls, "frozen": freeze.repeats, "from": start, "to": newest}
