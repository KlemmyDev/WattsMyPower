"""
Maintenance commands, run inside the container:

    docker compose exec wattsmypower python -m app reset-account

reset-account  remove the dashboard's account and every session; the next visit asks for a new one
"""

from __future__ import annotations

import sys

from app.core.config import Config
from app.core.database import Database
from app.features.auth.service import AuthService


def main(argv: list[str]) -> int:
    if argv == ["reset-account"]:
        db = Database(Config.from_env().db_path)
        db.migrate()
        AuthService(db, enabled=True).reset()
        print("Account and sessions removed. Open the dashboard to create a new account.")
        return 0
    print(__doc__.strip())
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
