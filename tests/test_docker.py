"""The Docker set-up: docker-entrypoint.sh (with root, the data folder and setpriv stood in for) and the compose files."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
SHELLS = [s for s in ("dash", "sh") if shutil.which(s)]  # dash is the image's /bin/sh

STUBS = {
    # Who it's started as, and who owns /data, from the test.
    "id": 'echo "$FAKE_ID"',
    "stat": 'case "$2" in %u) echo "$DATA_UID" ;; %g) echo "$DATA_GID" ;; esac',
    "find": 'echo "find $*" >>"$LOG"',
    "setpriv": 'echo "setpriv $*" >>"$LOG"',
}


def _start(tmp_path: Path, shell: str, **env: str) -> tuple[list[str], str]:
    """Run the entrypoint with `started` as the service: what it did (the log), and what it said."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    for name, body in STUBS.items():
        (bin_dir / name).write_text(f"#!/bin/sh\n{body}\n")
        (bin_dir / name).chmod(0o755)
    log = tmp_path / "log"
    log.write_text("")
    base = {"PATH": f"{bin_dir}:{os.environ['PATH']}", "LOG": str(log), "FAKE_ID": "0", "DATA_UID": "0"}
    base |= {"DATA_GID": "0", "TZ": "Australia/Perth"}
    run = subprocess.run(
        [shell, str(ROOT / "docker-entrypoint.sh"), "sh", "-c", 'echo "started as $TZ" >>"$LOG"'],
        env=base | env,
        capture_output=True,
        text=True,
        check=True,
    )
    return log.read_text().splitlines(), run.stderr


@pytest.fixture(params=SHELLS)
def shell(request: pytest.FixtureRequest) -> str:
    return str(request.param)


def test_an_install_from_before_is_handed_over_and_runs_as_10001(tmp_path: Path, shell: str) -> None:
    did, _ = _start(tmp_path, shell)
    assert did[0].startswith("find /data -xdev ( ! -user 10001 -o ! -group 10001 ) -exec chown -h 10001:10001")
    assert did[1] == "setpriv --reuid=10001 --regid=10001 --clear-groups -- sh -c " + 'echo "started as $TZ" >>"$LOG"'


def test_it_runs_as_whoever_owns_the_data_folder(tmp_path: Path, shell: str) -> None:
    """On a Raspberry Pi installed by its user, say: the files stay theirs, and updater.sh can write next to them."""
    did, _ = _start(tmp_path, shell, DATA_UID="1000", DATA_GID="1001")
    assert "chown -h 1000:1001" in did[0]
    assert did[1].startswith("setpriv --reuid=1000 --regid=1001 --clear-groups -- ")


def test_bluetooth_keeps_root_unless_given_its_group(tmp_path: Path, shell: str) -> None:
    did, _ = _start(tmp_path, shell, RUN_AS_ROOT="true", BLUETOOTH_GID="")
    assert did[0].startswith("find /data") and did[1] == "started as Australia/Perth"  # no setpriv
    did, _ = _start(tmp_path, shell, RUN_AS_ROOT="true", BLUETOOTH_GID="112")
    assert did[1].startswith("setpriv --reuid=10001 --regid=10001 --groups=112 -- ")


def test_started_as_someone_else_it_just_starts(tmp_path: Path, shell: str) -> None:
    did, _ = _start(tmp_path, shell, FAKE_ID="10001")
    assert did == ["started as Australia/Perth"]


@pytest.mark.skipif(not Path("/usr/share/zoneinfo/Australia/Perth").exists(), reason="needs the time zone database")
def test_it_says_when_the_time_zone_isnt_set(tmp_path: Path, shell: str) -> None:
    did, said = _start(tmp_path, shell, FAKE_ID="10001", TZ="Australia/Brisbane", TZ_CHOSEN="")
    assert "TZ isn't set in .env" in said and did == ["started as Australia/Brisbane"]
    _, said = _start(tmp_path, shell, FAKE_ID="10001", TZ_CHOSEN="Australia/Perth")
    assert said == ""
    _, said = _start(tmp_path, shell, FAKE_ID="10001", TZ="Perth", TZ_CHOSEN="Perth")
    assert "TZ=Perth isn't a time zone" in said
    did, _ = _start(tmp_path, shell, FAKE_ID="10001", TZ="")  # without compose
    assert did == ["started as Australia/Brisbane"]


def _compose(name: str) -> dict[str, Any]:
    yaml = pytest.importorskip("yaml")
    return dict(yaml.safe_load((ROOT / name).read_text()))


def test_compose_keeps_the_collector_on_this_machine_and_the_logs_small() -> None:
    services = _compose("docker-compose.yml")["services"]
    assert services["collector"]["ports"] == ["${COLLECTOR_BIND:-127.0.0.1}:${COLLECTOR_PORT:-8081}:8081"]
    assert services["wattsmypower"]["depends_on"] == {"collector": {"condition": "service_healthy"}}
    for service in services.values():
        assert service["logging"]["options"] == {"max-size": "10m", "max-file": "3"}
        assert service["environment"]["TZ_CHOSEN"] == "${TZ:-}"
    bluetooth = _compose("docker-compose.bluetooth.yml")["services"]["wattsmypower"]["environment"]
    assert bluetooth == {"RUN_AS_ROOT": "true", "BLUETOOTH_GID": "${BLUETOOTH_GID:-}"}


def test_the_base_images_are_pinned() -> None:
    images = [line.split()[1] for line in (ROOT / "Dockerfile").read_text().splitlines() if line.startswith("FROM ")]
    images += [w.removeprefix("--from=") for w in (ROOT / "Dockerfile").read_text().split() if "--from=ghcr.io" in w]
    pinned = [i for i in images if "@sha256:" in i]
    assert len(pinned) == 3 and all(len(i.split("@sha256:")[1]) == 64 for i in pinned)
