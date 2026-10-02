"""`python -m collector`: serve the feed (and run the poller) with uvicorn."""

from __future__ import annotations

import uvicorn

from collector.config import Config


def main() -> None:
    # One worker on purpose: the poller lives in-process and the WiNet-S2 doesn't like more than
    # one Modbus client at a time. A short graceful shutdown so held long-polls don't stall a restart.
    uvicorn.run(
        "collector.main:app",
        host="0.0.0.0",
        port=Config.from_env().port,
        workers=1,
        access_log=False,
        timeout_graceful_shutdown=5,
    )


if __name__ == "__main__":
    main()
