#!/usr/bin/env bash
# Updates WattsMyPower when the dashboard asks (Manage → System → Updates → Update now).
#
# install.sh sets this up to run every minute (cron). Each time, it leaves a note that it's here and whether it can
# update (data/update/updater.json). When the dashboard has asked for an update (data/update/request), it runs this
# folder's install.sh --yes, as you would by hand: the release channel's version from GitHub (data/update/channel,
# newer or older), the databases backed up, rebuilt and restarted. Its output goes to data/update/update.log and how it
# went to data/update/status.json, which the dashboard shows. The dashboard can only ask: what runs is install.sh, and
# nothing in the request is read but when it was made.
#
# Remove it with: crontab -l | grep -v 'WattsMyPower: updates from the dashboard' | crontab -
set -uo pipefail

cd "$(dirname "$0")" || exit 1
# cron starts with a bare PATH: add where Docker and git usually are (Docker Desktop and Homebrew on a Mac).
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

DIR=data/update
STALE_REQUEST=900  # seconds: a request older than this (the updater was off) is dropped rather than acted on late
mkdir -p "$DIR" || exit 1

now() { date +%s; }
# A JSON string: quotes, backslashes and control characters escaped.
jstr() { printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\000-\037')"; }
# Write a file whole (the dashboard never reads half of one).
put() { printf '%s\n' "$2" >"$DIR/.$1.tmp" && mv -f "$DIR/.$1.tmp" "$DIR/$1"; }

# Can it update without a password? Docker itself, or sudo that doesn't ask (as install.sh would use it).
why=""
if ! command -v git >/dev/null 2>&1; then
  why="git isn't installed on this machine"
elif ! docker info >/dev/null 2>&1 && ! { command -v sudo >/dev/null 2>&1 && sudo -n docker info >/dev/null 2>&1; }; then
  why="Docker can't be used without a password here: add your user to the docker group (sudo usermod -aG docker \$USER), or update with bash install.sh"
elif [ -n "$(git status --porcelain --untracked-files=no 2>/dev/null)" ]; then
  why="this folder has local changes, which an update would overwrite"
fi
put updater.json "{\"seen_at\": $(now), \"can_update\": $([ -z "$why" ] && echo true || echo false), \"why\": $([ -n "$why" ] && jstr "$why" || echo null)}"

[ -f "$DIR/request" ] || exit 0

# One at a time: cron starts another run every minute while an update is going (a lock left by a crash expires).
if ! mkdir "$DIR/.running" 2>/dev/null; then
  [ -n "$(find "$DIR/.running" -maxdepth 0 -mmin +60 2>/dev/null)" ] || exit 0
  rm -rf "$DIR/.running" && mkdir "$DIR/.running" || exit 0
fi
trap 'rm -rf "$DIR/.running"' EXIT

asked="$(stat -c %Y "$DIR/request" 2>/dev/null || stat -f %m "$DIR/request" 2>/dev/null || now)"
rm -f "$DIR/request"
from="$(git rev-parse HEAD 2>/dev/null || true)"
if [ $(($(now) - asked)) -gt "$STALE_REQUEST" ]; then
  put status.json "{\"state\": \"expired\", \"requested_at\": $asked, \"finished_at\": $(now)}"
  exit 0
fi
if [ -n "$why" ]; then
  put status.json "{\"state\": \"failed\", \"requested_at\": $asked, \"finished_at\": $(now), \"from\": $(jstr "$from"), \"error\": $(jstr "$why")}"
  exit 0
fi

started="$(now)"
put status.json "{\"state\": \"running\", \"requested_at\": $asked, \"started_at\": $started, \"from\": $(jstr "$from")}"
bash ./install.sh --yes >"$DIR/update.log" 2>&1
code=$?
to="$(git rev-parse HEAD 2>/dev/null || true)"
if [ "$code" = 0 ]; then
  put status.json "{\"state\": \"done\", \"requested_at\": $asked, \"started_at\": $started, \"finished_at\": $(now), \"from\": $(jstr "$from"), \"to\": $(jstr "$to")}"
else
  put status.json "{\"state\": \"failed\", \"requested_at\": $asked, \"started_at\": $started, \"finished_at\": $(now), \"from\": $(jstr "$from"), \"to\": $(jstr "$to"), \"error\": $(jstr "install.sh stopped (exit $code): see data/update/update.log")}"
fi
