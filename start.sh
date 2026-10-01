#!/usr/bin/env bash
# Start WattsMyPower, and Docker first if it isn't running. Doesn't update or rebuild
# anything: use install.sh for the first install and for updates.
#
#   bash start.sh
#
# To stop it: docker compose stop (from this folder).
exec bash "$(dirname "$0")/install.sh" --start "$@"
