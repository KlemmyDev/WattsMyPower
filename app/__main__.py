"""
Maintenance commands, run inside the container:

    docker compose exec wattsmypower python -m app reset-account
    docker compose exec wattsmypower python -m app reprocess [YYYY-MM-DD]

reset-account  remove the dashboard's account and every session; the next visit asks for a new one, with the
               set-up code it prints
reprocess      rebuild readings from the collector's raw registers (from a date, or everything it holds),
               after a change to how they're decoded
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import sys

from app.core.config import Config
from app.core.database import Database
from app.features.auth.service import AuthService
from app.features.live.client import CollectorClient
from app.features.live.reprocess import reprocess


def main(argv: list[str]) -> int:
    os.umask(0o077)  # like the app: what it creates is for its own user only
    config = Config.from_env()
    db = Database(config.db_path)
    if argv == ["reset-account"]:
        db.migrate()
        auth = AuthService(db, enabled=True)
        auth.reset()
        print("Account and sessions removed.")
        auth.prepare_setup_code()  # and shows the set-up code the new account needs
        return 0
    if argv[:1] == ["reprocess"] and len(argv) <= 2:
        logging.basicConfig(level=logging.INFO, format="%(message)s")
        since = int(dt.datetime.fromisoformat(argv[1]).timestamp()) if len(argv) == 2 else None
        db.migrate()
        done = reprocess(config, db, CollectorClient(config.collector_url, config.collector_token), since)
        if not done["polls"]:
            print("The collector has no raw readings to reprocess yet.")
        else:
            span = " to ".join(
                dt.datetime.fromtimestamp(t).strftime("%Y-%m-%d %H:%M") for t in (done["from"], done["to"])
            )
            frozen = f", leaving out {done['frozen']} frozen repeats" if done["frozen"] else ""
            print(f"Rebuilt {done['polls']} readings ({span}){frozen}.")
        return 0
    print(__doc__.strip())
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
