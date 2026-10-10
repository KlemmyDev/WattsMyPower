#!/bin/sh
# Starts the collector or the dashboard in its container (the Dockerfile's ENTRYPOINT for both), as an ordinary user
# rather than root.
#
# Docker starts it as root, so first it hands the data folder (/data) to the user the service runs as, then drops root
# for good (setpriv) before starting the service:
#   - that user is whoever owns the data folder on this machine (on a Raspberry Pi, say, the user who installed it),
#     so the files stay theirs and updater.sh keeps writing in data/update; or uid 10001 when the folder is root's.
#   - installs from before this ran as root, so their files are root's: they're handed over the first time, and
#     anything made root's since (a docker compose exec, a backup copied in) at each start. Only those are changed.
# RUN_AS_ROOT=true keeps root (docker-compose.bluetooth.yml sets it for BlueZ, unless BLUETOOTH_GID is set: see there).
set -eu

umask 077  # databases, backups and anything else it makes are only the service's to read

# Days roll over (and daily totals are added up) at midnight in TZ. install.sh sets it in .env; without it,
# docker-compose.yml falls back to Brisbane and says so with an empty TZ_CHOSEN.
export TZ="${TZ:-Australia/Brisbane}"
if [ "${TZ_CHOSEN-unset}" = "" ]; then
  echo "TZ isn't set in .env, so days roll over at midnight in $TZ. Set your time zone with bash install.sh --configure (or TZ=Australia/Perth, say, in .env)." >&2
elif [ ! -f "/usr/share/zoneinfo/$TZ" ]; then
  echo "TZ=$TZ isn't a time zone (they're named like Australia/Sydney), so times are UTC. Fix it with bash install.sh --configure (or in .env)." >&2
fi

if [ "$(id -u)" != 0 ]; then
  exec "$@"
fi

uid="$(stat -c %u /data)"
gid="$(stat -c %g /data)"
[ "$uid" != 0 ] || uid=10001
[ "$gid" != 0 ] || gid=10001
# -h: a link is changed itself, never what it points to.
find /data -xdev \( ! -user "$uid" -o ! -group "$gid" \) -exec chown -h "$uid:$gid" {} + 2>/dev/null \
  || echo "Couldn't hand everything in the data folder to uid $uid; if it can't write there, check data/'s owner on this machine." >&2

if [ "${RUN_AS_ROOT:-}" = true ] && [ -z "${BLUETOOTH_GID:-}" ]; then
  exec "$@"
fi
export HOME=/tmp  # nothing of its own outside /data
if [ -n "${BLUETOOTH_GID:-}" ]; then
  exec setpriv --reuid="$uid" --regid="$gid" --groups="$BLUETOOTH_GID" -- "$@"
fi
exec setpriv --reuid="$uid" --regid="$gid" --clear-groups -- "$@"
