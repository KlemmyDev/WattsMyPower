#!/usr/bin/env bash
# Install or update WattsMyPower with Docker.
#
#   Install:  curl -fsSL https://raw.githubusercontent.com/KlemmyDev/WattsMyPower/main/install.sh | bash
#             (options after "bash -s --", e.g. curl ... | bash -s -- --channel stable)
#   Update:   cd wattsmypower && bash install.sh
#
# It follows a release channel, chosen in the dashboard (Manage → System → Updates) or with --channel: nightly (every
# change, as it's merged to main), beta (pre-releases and releases; a new install's) or stable (releases only). An
# update goes to the channel's version, so after moving to a channel behind this one (nightly to stable) it goes back
# to that version.
#
# Runs on Linux and in WSL (Docker is installed if it's missing), and on a Mac with Docker
# Desktop (started if it isn't running). On Windows, install.ps1 sets up WSL and runs this.
#
# Run from anywhere other than a WattsMyPower folder, it downloads WattsMyPower into
# ./wattsmypower (installing git first if needed) and carries on from there. Run inside
# that folder, it updates it.
#
# Your data (data/) and settings (.env) are never overwritten, and only you can read them. Before each update
# both databases are backed up to data/backups/: the newest 5 are kept, and the newest from each of the last 5
# versions and from each channel (so the last one from before trying beta stays). If they can't be backed up, it
# stops before rebuilding. The version it replaces is kept too, for --rollback.
#
# Options:  --configure  change your settings (time zone, port), then restart. Your current
#                        values are the defaults. Inverters are connected, and the array size
#                        set, in the dashboard: Manage → Integrations and Manage → System.
#           --start      just start it (and Docker if needed): no update, rebuild or
#                        questions. start.sh does the same.
#           --no-dashboard-updates
#                        don't set up updating from the dashboard (Manage → System → Updates).
#                        Otherwise a cron job runs updater.sh every minute, which updates when the
#                        dashboard asks (it runs this script, as you would).
#           Bluetooth (portable batteries, Teslas) is connected through to the dashboard when this machine has an
#           adapter with BlueZ running: run this again after adding one. BLUETOOTH=off in .env turns that off.
#           --channel nightly|beta|stable
#                        follow this release channel from now on (otherwise the one chosen in the dashboard;
#                        beta for a new install). Its version is installed, newer or older than this one.
#           --rollback   go back to the version before the last update, with the databases put back as they were
#                        before it (the ones there now are backed up first). Updating again brings the newer one back.
#           --no-backup  update (or go back) even when the databases can't be backed up first
#           --uninstall  stop it, and remove its containers, images and updater cron job. Your data (data/, with
#                        the backups in data/backups/) and settings (.env) stay in this folder: nothing is deleted.
#           -y, --yes    accept the defaults and don't ask anything. Settings can also be
#                        passed in, e.g. TZ=Australia/Perth bash install.sh --yes, and on a first
#                        install PV_KW=10 or INVERTER_HOST=... to set up without the dashboard
#           -h, --help   show this help
#
# First install only:  WMP_DIR=/path  folder to install into (default: ./wattsmypower)
set -euo pipefail

APP=wattsmypower
REPO=https://github.com/KlemmyDev/WattsMyPower.git
CRON_TAG="# WattsMyPower: updates from the dashboard"
BACKUPS=data/backups
PREVIOUS=data/update/previous  # the version an update replaced, for --rollback

YES=0
PULL=1
CONFIGURE=0
START=0
HELP=0
DASHBOARD_UPDATES=1
BACKUP=1
ROLLBACK=0
UNINSTALL=0
CHANNEL=""
want_channel=0
for arg in "$@"; do
  if [ "$want_channel" = 1 ]; then CHANNEL="$arg"; want_channel=0; continue; fi
  case "$arg" in
    --channel) want_channel=1 ;;
    --channel=*) CHANNEL="${arg#--channel=}" ;;
    -y|--yes) YES=1 ;;
    --configure) CONFIGURE=1 ;;
    --start) START=1; PULL=0 ;;
    --no-pull) PULL=0 ;;  # internal: used when the script restarts itself after updating
    --no-dashboard-updates) DASHBOARD_UPDATES=0 ;;
    --no-backup) BACKUP=0 ;;
    --rollback) ROLLBACK=1; PULL=0 ;;
    --uninstall) UNINSTALL=1; PULL=0 ;;
    -h|--help) HELP=1 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done
[ "$want_channel" = 0 ] || { echo "--channel needs one of: nightly, beta, stable" >&2; exit 2; }
case "$CHANNEL" in ""|nightly|beta|stable) ;; *) echo "There's no '$CHANNEL' channel: it's nightly, beta or stable." >&2; exit 2 ;; esac

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
interactive() { [ "$YES" = 0 ] && { true </dev/tty; } 2>/dev/null; }  # asking needs a terminal we can open
# ask "Question" "default": prints the answer (the default when not interactive)
ask() {
  local answer
  if ! interactive; then printf '%s' "$2"; return; fi
  read -r -p "  $1${2:+ [$2]}: " answer </dev/tty
  printf '%s' "${answer:-$2}"
}
confirm() {
  local answer
  [ "$YES" = 1 ] && return 0
  interactive || return 1
  read -r -p "  $1 [y/N] " answer </dev/tty
  [[ "$answer" =~ ^[Yy] ]]
}
# .env helpers (KEY=value lines)
get_env() { sed -n "s/^$1=//p" "${2:-.env}" 2>/dev/null | head -n 1; }
set_env() {
  local tmp
  tmp="$(mktemp)"
  if grep -q "^$1=" .env; then
    awk -v k="$1" -v v="$2" 'BEGIN { FS = OFS = "=" } $1 == k { print k "=" v; next } { print }' .env >"$tmp"
  else
    cat .env >"$tmp"; printf '%s=%s\n' "$1" "$2" >>"$tmp"
  fi
  cat "$tmp" >.env; rm -f "$tmp"
}

# Where it's running: linux, mac, wsl (Windows, inside WSL) or windows (Git Bash and the like).
case "$(uname -s)" in
  Darwin) OS=mac ;;
  MINGW* | MSYS* | CYGWIN*) OS=windows ;;
  *) if [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qi microsoft /proc/version 2>/dev/null; then OS=wsl; else OS=linux; fi ;;
esac
SUDO=""  # Docker Desktop (Mac) runs as you: nothing here needs root there
if [ "$OS" != mac ] && [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi

# In WSL the databases have to be on Linux's own disk: SQLite isn't reliable on a Windows drive
# (/mnt/c) shared into Docker.
check_folder() {
  if [ "$OS" = wsl ]; then
    case "$1" in /mnt/[a-z]/*) die "$1 is on a Windows drive, where the databases wouldn't be reliable. Run this from your Linux home folder instead (cd ~), or choose a folder there with WMP_DIR=~/wattsmypower." ;; esac
  fi
}

# ---------------------------------------------------------------- find (or download) the app
# This script's own folder, when it's being run from a file rather than piped in from curl.
SELF_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; fi
is_app() { [ -f "$1/docker-compose.yml" ] && [ -d "$1/app" ] && [ -f "$1/install.sh" ]; }

if [ "$HELP" = 1 ]; then
  if [ -n "$SELF_DIR" ]; then awk 'NR > 1 && /^set -euo/ { exit } NR > 1' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  else echo "Usage: curl -fsSL https://raw.githubusercontent.com/KlemmyDev/WattsMyPower/main/install.sh | bash -s -- [--yes] [--channel nightly|beta|stable]"; fi
  exit 0
fi

if [ "$OS" = windows ]; then
  die "On Windows, install it with install.ps1 instead, which sets up WSL and runs this there. In PowerShell: irm https://raw.githubusercontent.com/KlemmyDev/WattsMyPower/main/install.ps1 | iex"
fi

if [ -z "$SELF_DIR" ] || ! is_app "$SELF_DIR"; then
  DIR="${WMP_DIR:-$(pwd)/wattsmypower}"
  check_folder "$DIR"
  if is_app "$DIR"; then
    say "WattsMyPower is already in $DIR: updating it"
  else
    [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ] && die "$DIR already exists and isn't a WattsMyPower folder. Move it, or choose another folder with WMP_DIR=/path."
    if ! git --version >/dev/null 2>&1; then  # (on a Mac, this offers to install the command line tools)
      warn "git is needed to download WattsMyPower and to update it later."
      [ "$OS" = mac ] && die "Install git (xcode-select --install, or brew install git) and run this again."
      command -v apt-get >/dev/null 2>&1 || die "Install git (https://git-scm.com/downloads) and run this again."
      confirm "Install git now (apt-get install git)?" || die "Install git (apt install git) and run this again."
      $SUDO apt-get update -qq && $SUDO apt-get install -y -qq git
    fi
    say "Downloading WattsMyPower into $DIR"
    git clone --branch main "$REPO" "$DIR"
  fi
  exec bash "$DIR/install.sh" "$@"
fi
cd "$SELF_DIR"
HERE="$SELF_DIR"
check_folder "$HERE"

# ---------------------------------------------------------------- the release channel
# Kept in data/update/channel, where the dashboard reads and changes it too (Manage → System → Updates). It's saved on
# every install, so the dashboard shows the one this follows.
CHANNEL_FILE=data/update/channel
saved_channel="$(tr -d '[:space:]' <"$CHANNEL_FILE" 2>/dev/null || true)"
case "$saved_channel" in nightly|beta|stable) ;; *) saved_channel="" ;; esac
chosen="$CHANNEL"
if [ -z "$CHANNEL" ] && [ -z "$saved_channel" ]; then
  # None chosen yet. A new install follows beta. One from before beta was the default (it has its .env, but no channel
  # saved) has been following nightly, and carries on with it.
  if [ -f .env ]; then CHANNEL=nightly; else CHANNEL=beta; fi
fi
if [ -n "$CHANNEL" ] && [ "$CHANNEL" != "$saved_channel" ]; then
  # Written whole, beside the old one (which the dashboard may have written, as root): this folder is yours.
  if mkdir -p data/update 2>/dev/null && printf '%s\n' "$CHANNEL" >"$CHANNEL_FILE.tmp" 2>/dev/null && mv -f "$CHANNEL_FILE.tmp" "$CHANNEL_FILE"; then
    if [ -n "$chosen" ]; then info "Following the $CHANNEL channel from now on."
    else info "Following the $CHANNEL channel. Manage → System → Updates (or --channel) changes it."; fi
  else
    warn "Couldn't save the channel in $CHANNEL_FILE: this update follows $CHANNEL, but the dashboard may show another."
  fi
fi
CHANNEL="${CHANNEL:-$saved_channel}"
# The channel before this run changed it (kept when the script restarts itself), for naming the backups.
export WMP_FROM_CHANNEL="${WMP_FROM_CHANNEL:-${saved_channel:-$CHANNEL}}"

# The newest release tag on the channel (blank if there's none yet): v2026.10.9 is stable, v2026.10.9-beta (then
# -beta.2…) a pre-release, which beta follows as well; no other tags count. versionsort.suffix puts a version's betas
# before it, and app/features/updates/service.py and scripts/release.sh put them in the same order.
channel_tag() {
  local pattern='^v[0-9]+(\.[0-9]+)*(-beta(\.[0-9]+)?)?$'
  [ "$1" = stable ] && pattern='^v[0-9]+(\.[0-9]+)*$'
  git -c versionsort.suffix=- tag -l 'v[0-9]*' --sort=-v:refname | grep -E "$pattern" | head -n 1 || true
}

# ---------------------------------------------------------------- update the code
if [ "$PULL" = 1 ] && [ -d .git ]; then
  say "Getting the latest version ($CHANNEL)"
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    git status --short --untracked-files=no
    die "These files have local changes, so the update would overwrite them. Commit or undo them (git checkout -- <file>) and run this again."
  fi
  before="$(git rev-parse HEAD)"
  export WMP_FROM_COMMIT="${WMP_FROM_COMMIT:-$before}"  # the version this update started from, across the restart below
  # Tags too, with any removed from GitHub (a release taken back) removed here.
  git fetch --quiet --tags --force --prune --prune-tags origin || die "Couldn't get the latest from GitHub: check this machine's internet connection, and run this again."
  if [ "$CHANNEL" = nightly ]; then
    # main, as it's merged: back on the branch if a release had been checked out.
    if [ "$(git symbolic-ref --quiet --short HEAD 2>/dev/null)" != main ]; then
      git checkout --quiet main 2>/dev/null || git checkout --quiet -b main --track origin/main
    fi
    git merge --quiet --ff-only origin/main
  else
    tag="$(channel_tag "$CHANNEL")"
    if [ -z "$tag" ]; then
      warn "Nothing has been released on the $CHANNEL channel yet, so this version stays. (bash install.sh --channel nightly follows every change.)"
    else
      git -c advice.detachedHead=false checkout --quiet --detach "refs/tags/$tag"
    fi
  fi
  after="$(git rev-parse HEAD)"
  where="$(git describe --tags --exact-match 2>/dev/null || git log -1 --format='%h')"
  if [ "$after" = "$before" ]; then
    info "Already up to date ($where, $(git log -1 --format='%cd' --date=short))."
  elif git merge-base --is-ancestor "$before" "$after"; then
    info "Updating to $where:"
    git log --oneline "$before..$after" | sed 's/^/  /'
  else
    # Moving to a channel behind this version: back to an older one. The databases are backed up below first.
    info "Going back to $where, without these newer changes:"
    git log --oneline "$after..$before" | sed 's/^/  /'
  fi
  # This script may itself have changed: carry on with the new version.
  if [ "$after" != "$before" ] && ! git diff --quiet "$before" "$after" -- install.sh; then exec bash "$HERE/install.sh" --no-pull "$@"; fi
fi

# ---------------------------------------------------------------- Docker
say "Checking Docker"
# On a Mac, Docker Desktop is an app: start it if it isn't running.
if [ "$OS" = mac ] && ! docker info >/dev/null 2>&1 && open -ga Docker 2>/dev/null; then  # -g: in the background
  info "Starting Docker Desktop (this can take a minute)"
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 2; done
fi
if ! command -v docker >/dev/null 2>&1; then
  [ "$OS" = mac ] && die "Docker isn't installed. Install Docker Desktop (https://docs.docker.com/desktop/setup/install/mac-install/), open it once, and run this again."
  # Docker runs as a service, so WSL needs systemd (install.ps1 turns it on).
  [ "$OS" = wsl ] && [ ! -d /run/systemd/system ] && die "Docker needs systemd, which is off in this WSL distribution. install.ps1 sets WSL up for WattsMyPower (see the README); or add [boot] systemd=true to /etc/wsl.conf, run 'wsl --shutdown' in Windows, and run this again."
  warn "Docker isn't installed."
  if confirm "Install it now with Docker's official install script (get.docker.com)?"; then
    command -v curl >/dev/null 2>&1 || die "curl is needed to download it: run 'apt install curl' and try again."
    [ "$OS" = wsl ] && info "(It suggests Docker Desktop when it sees WSL, and waits 20 seconds: carry on, it isn't needed here.)"
    curl -fsSL https://get.docker.com | $SUDO sh
  else
    die "Install Docker (https://docs.docker.com/engine/install/) and run this again."
  fi
fi
DOCKER="docker"
docker_ok() { docker info >/dev/null 2>&1 || { [ -n "$SUDO" ] && $SUDO docker info >/dev/null 2>&1; }; }
if command -v systemctl >/dev/null 2>&1 && systemctl cat docker.service >/dev/null 2>&1; then
  # Docker as a service (not Docker Desktop): start it if it isn't running, and have it start at
  # boot so the app comes back after a restart.
  if ! docker_ok; then info "Starting Docker"; $SUDO systemctl start docker || true; fi
  if [ "$(systemctl is-enabled docker 2>/dev/null)" != enabled ]; then $SUDO systemctl enable docker >/dev/null 2>&1 && info "Docker will now start at boot." || true; fi
fi
if ! docker info >/dev/null 2>&1; then
  if [ -n "$SUDO" ] && $SUDO docker info >/dev/null 2>&1; then DOCKER="$SUDO docker"
  elif [ "$OS" != mac ]; then die "Docker is installed but isn't running, or this user can't use it. Start it (systemctl start docker) or run this as root."
  else die "Docker Desktop isn't running yet. Start it, wait until it says it's running, and run this again."; fi
fi
if $DOCKER compose version >/dev/null 2>&1; then DC="$DOCKER compose"
elif command -v docker-compose >/dev/null 2>&1; then DC="${SUDO:+$SUDO }docker-compose"
else die "Docker Compose isn't available. Install the compose plugin (apt install docker-compose-plugin) and run this again."; fi
info "$($DOCKER --version)"
# This machine's address on the home network (blank if it can't tell).
lan_ip() {
  local ip="" iface
  case "$OS" in
    mac)
      iface="$(route -n get default 2>/dev/null | awk '/interface:/ { print $2 }' || true)"
      ip="$(ipconfig getifaddr "${iface:-en0}" 2>/dev/null || true)" ;;
    wsl)  # ask Windows: WSL's own address can be private to this PC
      ip="$(powershell.exe -NoProfile -Command "(Get-NetIPConfiguration | Where-Object { \$_.IPv4DefaultGateway -and \$_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress" 2>/dev/null | tr -d '\r' || true)" ;;
  esac
  [ -n "$ip" ] || ip="$( (hostname -I 2>/dev/null || true) | awk '{ print $1 }')"
  printf '%s' "$ip"
}
# Wait until the app answers, then show where it is.
wait_and_report() {
  local ok=0 ip
  info "Waiting for it to respond..."
  for _ in $(seq 1 45); do
    if $DOCKER exec "$APP" python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)" >/dev/null 2>&1; then ok=1; break; fi
    sleep 2
  done
  ip="$(lan_ip)"
  if [ "$ok" = 1 ]; then
    local port; port="$(get_env PORT)"
    say "WattsMyPower is running: http://${ip:-localhost}:${port:-8080}"
    # Until the account's made, creating it needs the one-time code the dashboard keeps in data/setup-code.
    local code; code="$($DOCKER exec "$APP" cat /data/setup-code 2>/dev/null | tr -d '[:space:]' || true)"
    if [ -n "$code" ]; then
      info "Set-up code: $code (the dashboard asks for it once, to create its account)"
    fi
    info "New install? Connect your inverter there: Manage → Integrations finds it on your network."
    if [ "$OS" = mac ]; then
      info "It only records while Docker Desktop is running: keep 'Start Docker Desktop when you sign in to your computer'"
      info "on (Docker Desktop → Settings → General), and stop this computer sleeping."
    fi
    info "Logs: $DC logs -f --tail=50"
  else
    warn "It started but isn't responding yet. Recent logs:"
    $DC logs --tail=30
    if [ -f "$PREVIOUS" ]; then warn "If it doesn't come right, bash install.sh --rollback goes back to the version before."; fi
    exit 1
  fi
}

# ---------------------------------------------------------------- Bluetooth
# Portable batteries and Teslas can be reached over this machine's Bluetooth. The dashboard talks to the host's BlueZ
# over its D-Bus socket, which docker-compose.bluetooth.yml mounts: it's added (COMPOSE_FILE in .env, so a plain
# 'docker compose' uses it too) when there's an adapter and BlueZ is running. BLUETOOTH in .env: auto (the default),
# on (add it without checking) or off. A COMPOSE_FILE of the household's own is left alone.
#
# In a Proxmox LXC, Bluetooth can't be used (the kernel only allows it outside containers), so BlueZ runs on the
# Proxmox host and the host's D-Bus folder is mounted into the LXC. Found at /mnt/host-dbus, it's used instead
# (BLUETOOTH_DBUS in .env, which can also name another folder).
HOST_DBUS=/mnt/host-dbus
BT_FILES="docker-compose.yml:docker-compose.bluetooth.yml"
unset_env() { local tmp; tmp="$(mktemp)"; grep -v "^$1=" .env >"$tmp" || true; cat "$tmp" >.env; rm -f "$tmp"; }
bluetooth_setup() {
  [ -f .env ] || return 0
  local want files dbus on=0
  want="$(get_env BLUETOOTH)"; want="${want:-auto}"
  files="$(get_env COMPOSE_FILE)"
  dbus="$(get_env BLUETOOTH_DBUS)"
  [ -z "$files" ] || [ "$files" = "$BT_FILES" ] || return 0
  if [ -z "$dbus" ] && [ "$want" != off ] && [ -S "$HOST_DBUS/system_bus_socket" ]; then
    dbus="$HOST_DBUS"
    set_env BLUETOOTH_DBUS "$dbus"
  fi
  if [ "$want" = on ]; then
    on=1
  elif [ "$want" != off ] && [ -n "$dbus" ] && [ "$dbus" != /run/dbus ]; then
    # BlueZ is on another machine's D-Bus (the Proxmox host's): there's nothing here to check but its socket.
    if [ -S "$dbus/system_bus_socket" ]; then
      on=1
      info "Bluetooth: using the D-Bus in $dbus (BlueZ on the Proxmox host)."
    else
      warn "BLUETOOTH_DBUS is $dbus, but there's no D-Bus socket there. Check the LXC's mount of the host's /run/dbus (see the README)."
    fi
  elif [ "$want" != off ] && [ "$OS" = linux ] && ls -d /sys/class/bluetooth/hci* >/dev/null 2>&1; then
    if [ ! -S /run/dbus/system_bus_socket ] || ! { pgrep -x bluetoothd >/dev/null 2>&1 || systemctl is-active --quiet bluetooth 2>/dev/null; }; then
      warn "This machine has a Bluetooth adapter, but BlueZ isn't running, so the dashboard can't use it. Install and start it (sudo apt install bluez && sudo systemctl enable --now bluetooth), then run this again."
    else
      on=1
      if command -v bluetoothctl >/dev/null 2>&1 && timeout 5 bluetoothctl show 2>/dev/null | grep -q "Powered: no"; then
        warn "The Bluetooth adapter is switched off. Switch it on (bluetoothctl power on; if it's blocked, rfkill unblock bluetooth)."
      fi
    fi
  fi
  if [ "$on" = 1 ] && [ "$files" != "$BT_FILES" ]; then
    set_env COMPOSE_FILE "$BT_FILES"
    info "Bluetooth: connected through to the dashboard (docker-compose.bluetooth.yml). BLUETOOTH=off in .env turns it off."
  elif [ "$on" = 0 ] && [ "$files" = "$BT_FILES" ]; then
    unset_env COMPOSE_FILE
    info "Bluetooth: no longer connected through to the dashboard."
  fi
}

if [ "$START" = 1 ]; then
  [ -f .env ] || die "WattsMyPower isn't installed in this folder yet: run bash install.sh first."
  say "Starting WattsMyPower"
  bluetooth_setup
  $DC up -d
  wait_and_report
  exit 0
fi

# What the running app was started with, so updates keep its settings (see below).
RUNNING_ENV="$($DOCKER inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$APP" 2>/dev/null || true)"

# ---------------------------------------------------------------- backups
# Before an update both databases are copied to data/backups/ as <name>-<when>-<version>.db, the version being the one
# that made them and its channel (2026.10.9-beta), so the last one from before a change of version is easy to find. The
# newest 5 of each are kept, the newest from each of the last 5 versions and from each channel (the last on stable
# before trying beta), and the one --rollback would put back.
#
# Files in data/ can belong to root (the containers run as root): priv runs a command as you, then with sudo.
priv() { "$@" 2>/dev/null || { [ -n "$SUDO" ] && $SUDO "$@"; }; }
# What data/update/previous notes about the version the last update replaced (blank if there's none).
noted() { get_env "$1" "$PREVIOUS" || true; }
# Whether a file in data/ is there (asking sudo only when data/ can't be looked in).
in_data() { [ -e "$1" ] || { [ ! -x data ] && priv test -e "$1"; }; }
# The version a commit is, as backups are named: its version and the channel, e.g. 2026.10.9-beta.
version_label() {
  local v; v="$(git show "$1:pyproject.toml" 2>/dev/null | sed -n 's/^version = "\(.*\)"$/\1/p' | head -n 1 | tr -cd '0-9A-Za-z.' || true)"
  printf '%s-%s' "${v:-unknown}" "$2"
}
# The version being replaced: the commit the dashboard running now was built from, else the one this update started
# from (blank outside a git checkout).
from_commit() {
  local c; c="$(printf '%s\n' "$RUNNING_ENV" | sed -n 's/^GIT_COMMIT=//p' | head -n 1)"
  if [ -n "$c" ] && git cat-file -e "$c^{commit}" 2>/dev/null; then printf '%s' "$c"; return; fi
  printf '%s' "${WMP_FROM_COMMIT:-$(git rev-parse HEAD 2>/dev/null || true)}"
}
# The backup, run with Python in the dashboard's container (or its image): SQLite's online backup, safe while the app
# keeps recording. Then the older backups are tidied away (see above). Arguments: when, version, the one to keep.
BACKUP_PY="$(cat <<'PY'
import os, re, sqlite3, sys
stamp, label, keep = sys.argv[1:4]
folder = "/data/backups"
os.makedirs(folder, exist_ok=True)
for name in ("wattsmypower", "collector"):  # the dashboard's database, and the collector's raw readings
    path = f"/data/{name}.db"
    if not os.path.exists(path):
        continue
    dest = f"{folder}/{name}-{stamp}-{label}.db"
    src, dst = sqlite3.connect(path), sqlite3.connect(dest)
    try:
        src.backup(dst)
    except BaseException:
        dst.close()
        os.remove(dest)
        raise
    dst.close(); src.close()
    print("  data/backups/" + os.path.basename(dest))
    # Newest first. Backups from before versions were in the name have none, and count as one version.
    pattern = re.compile(rf"{name}-(\d{{8}}-\d{{6}})(?:-(.+))?\.db")
    found = sorted(((m[1], m[2] or "", f) for f in os.listdir(folder) if (m := pattern.fullmatch(f))), reverse=True)
    versions, channels = [], set()
    for i, (_, version, f) in enumerate(found):
        newest_of_version = version not in versions
        if newest_of_version:
            versions.append(version)
        channel = version.rpartition("-")[2]
        newest_of_channel = channel not in channels
        channels.add(channel)
        if i < 5 or (newest_of_version and len(versions) <= 5) or newest_of_channel or f == f"{name}-{keep}.db":
            continue
        for old in (f, f + "-wal", f + "-shm"):
            if os.path.exists(f"{folder}/{old}"):
                os.remove(f"{folder}/{old}")
PY
)"
# On this machine instead, when there's no image to run it in: with sqlite3, or by stopping the app and copying the
# files. $1 sqlite3 or copy, $2 when, $3 version. (These aren't tidied: the next backup in a container does that.)
host_backup() {
  local name dest ext
  if [ "$1" = copy ]; then
    info "Stopping it to copy them (it starts again after)."
    $DC stop >/dev/null 2>&1 || return 1
    STOPPED=1
  fi
  priv mkdir -p "$BACKUPS" || return 1
  for name in wattsmypower collector; do
    in_data "data/$name.db" || continue
    dest="$BACKUPS/$name-$2-$3.db"
    if [ "$1" = sqlite3 ]; then
      priv sqlite3 "data/$name.db" ".backup '$dest'" || return 1
    else
      # With its write-ahead log, if it has one left: the two together are the database.
      for ext in "" -wal; do
        ! in_data "data/$name.db$ext" || priv cp -p "data/$name.db$ext" "$dest$ext" || return 1
      done
    fi
    info "$dest"
  done
}
# Back up both databases (when there are any yet), as version $1. Sets BACKUP_MADE to the backup's <when>-<version>;
# fails if they couldn't be backed up.
STOPPED=0
trap 'if [ "$STOPPED" = 1 ]; then $DC start >/dev/null 2>&1 || true; fi' EXIT  # stopped for a backup: started again
BACKUP_MADE=""
backup_databases() {
  local label="$1" stamp image keep
  in_data data/wattsmypower.db || in_data data/collector.db || return 0
  stamp="$(date +%Y%m%d-%H%M%S)"
  keep="$(noted backup)"
  say "Backing up the databases"
  # In the dashboard's container; if it isn't running (stopped, or restarting after a crash), in a new one from its
  # image; failing those, on this machine.
  if printf '%s\n' "$BACKUP_PY" | $DOCKER exec -i "$APP" python - "$stamp" "$label" "$keep" 2>/dev/null; then :
  elif image="$($DOCKER inspect -f '{{.Image}}' "$APP" 2>/dev/null)" && [ -n "$image" ] \
    && info "The dashboard isn't answering, so they're backed up with its image instead." \
    && printf '%s\n' "$BACKUP_PY" | $DOCKER run --rm -i --network none --entrypoint python -v "$HERE/data:/data" "$image" - "$stamp" "$label" "$keep"; then :
  elif command -v sqlite3 >/dev/null 2>&1 && host_backup sqlite3 "$stamp" "$label"; then :
  elif host_backup copy "$stamp" "$label"; then :
  else return 1; fi
  BACKUP_MADE="$stamp-$label"
  info "Backups are in $HERE/$BACKUPS."
  info "Now and then, copy one somewhere other than this machine: a backup on the same disk is no help if the disk fails."
}

# ---------------------------------------------------------------- go back (--rollback)
# Each update that changes the version keeps the one it replaced: its images, tagged :previous, and in data/update/previous
# its commit, version and the backup made before it. Going back checks out that commit, starts those images again (or
# rebuilds them), and puts that backup back, after backing up the databases as they are.
running_images() {  # "<image name> <image id>" for each container
  local c
  for c in "$APP" "$APP-collector"; do $DOCKER inspect -f '{{.Config.Image}} {{.Image}}' "$c" 2>/dev/null || true; done
}
# Remove those of these images that no name points to any more (replaced by an update, or by going back), unless a
# container still uses one.
drop_unnamed() {
  local id
  for id in "$@"; do
    [ "$($DOCKER image inspect -f '{{len .RepoTags}}' "$id" 2>/dev/null || echo 1)" = 0 ] && $DOCKER rmi "$id" >/dev/null 2>&1 || true
  done
}
rollback() {
  local commit version backup images when name src restore="" img build=0 replaced
  [ -f .env ] || die "WattsMyPower isn't installed in this folder."
  [ -f "$PREVIOUS" ] || die "There's no earlier version to go back to: one is kept by each update that changes the version."
  commit="$(noted commit)"; version="$(noted version)"; backup="$(noted backup)"
  images="$(noted images)"; when="$(noted when)"
  { [ -d .git ] && git cat-file -e "$commit^{commit}" 2>/dev/null; } || die "The version from before the last update ($version) isn't in this folder's git history, so it can't go back to it."
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    git status --short --untracked-files=no
    die "These files have local changes, which going back would overwrite. Commit or undo them (git checkout -- <file>) and run this again."
  fi
  for name in wattsmypower collector; do
    [ -n "$backup" ] && in_data "$BACKUPS/$name-$backup.db" && restore="$restore $name"
  done
  say "Going back to $version, as it was before the update on $when"
  if [ -n "$restore" ]; then
    info "The databases are put back as they were then, so what's been recorded since is left out of them. The ones there"
    info "now are backed up first, so this can be undone."
  else
    warn "The backup from before that update isn't in $BACKUPS any more, so the databases stay as they are."
  fi
  confirm "Go back to $version?" || die "Left as it is."
  if [ "$BACKUP" = 0 ]; then
    warn "Not backing up the databases first (--no-backup)."
  elif ! backup_databases "$(version_label "$(from_commit)" "$CHANNEL")"; then
    die "Couldn't back up the databases as they are now (see above), so nothing was changed. bash install.sh --rollback --no-backup goes back without."
  fi
  say "Going back"
  $DC stop
  STOPPED=1
  for name in $restore; do
    src="$BACKUPS/$name-$backup.db"
    # Copied in beside it first; then the current write-ahead log goes (it belongs to the newer database), and it's
    # swapped in.
    { priv cp -p "$src" "data/$name.db.restoring" && priv rm -f "data/$name.db-wal" "data/$name.db-shm" \
      && priv mv -f "data/$name.db.restoring" "data/$name.db"; } || die "Couldn't put back data/$name.db from $src."
    if in_data "$src-wal"; then priv cp -p "$src-wal" "data/$name.db-wal" || die "Couldn't put back data/$name.db-wal from $src-wal."; fi
    info "data/$name.db: put back from $src"
  done
  git -c advice.detachedHead=false checkout --quiet --detach "$commit"
  replaced="$(running_images | awk '{ print $2 }')"
  [ -n "$images" ] || build=1
  for img in $images; do $DOCKER tag "$img:previous" "$img" 2>/dev/null || build=1; done
  bluetooth_setup
  if [ "$build" = 1 ]; then
    info "Its images aren't here any more, so it's built again."
    $DC build --build-arg "GIT_COMMIT=$commit"
  fi
  $DC up -d --no-build --force-recreate --remove-orphans
  STOPPED=0
  # shellcheck disable=SC2086  # a list of image IDs
  drop_unnamed $replaced
  rm -f "$PREVIOUS"
  wait_and_report
  info "Updating again (bash install.sh, or Update now in the dashboard) goes to the $CHANNEL channel's newest version."
}
if [ "$ROLLBACK" = 1 ]; then rollback; exit 0; fi  # (on one line: the checkout above may have changed this file)

# ---------------------------------------------------------------- uninstall (--uninstall)
# Removes what Docker and cron have of it. data/ and .env are left in this folder, always: deleting them is up to you.
if [ "$UNINSTALL" = 1 ]; then
  [ -f .env ] || die "WattsMyPower isn't installed in this folder."
  say "Uninstalling WattsMyPower"
  info "This stops it, removes its containers and images, and stops updates from the dashboard. Your data and settings"
  info "stay in $HERE: nothing in data/ or .env is deleted."
  confirm "Uninstall it?" || die "Left as it is."
  images="$(running_images | awk '{ sub(/:latest$/, "", $1); print $1 }') $(noted images)"
  $DC down --rmi local --remove-orphans
  for img in $images; do $DOCKER rmi "$img:previous" >/dev/null 2>&1 || true; done
  if command -v crontab >/dev/null 2>&1 && crontab -l 2>/dev/null | grep -qF "$CRON_TAG"; then
    { crontab -l 2>/dev/null | grep -vF "$CRON_TAG" || true; } | crontab - && info "Removed the cron job for updates from the dashboard."
  fi
  say "Uninstalled. Your data is still here:"
  info "$HERE/data             the databases (wattsmypower.db, collector.db)"
  info "$HERE/data/backups     their backups, from before each update"
  info "$HERE/.env             your settings"
  info "bash install.sh in this folder puts it back as it was. To delete it all for good, copy anything you want to"
  info "keep somewhere else first, then: rm -rf '$HERE' (with sudo on Linux, where the app's files belong to root)."
  exit 0
fi

# ---------------------------------------------------------------- an existing install elsewhere
# (for example a copy unzipped into another folder before this was a git checkout)
if $DOCKER ps -a --format '{{.Names}}' | grep -qx "$APP"; then
  other="$($DOCKER inspect -f '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}' "$APP" 2>/dev/null || true)"
  if [ -n "$other" ] && [ "$other" != "$HERE" ]; then
    say "Found WattsMyPower already installed in $other"
    if [ -f .env ] || [ -f data/wattsmypower.db ]; then
      die "This folder already has its own .env or database, so nothing was moved. Stop the copy in $other ('cd $other && docker compose down') and run this again."
    fi
    if confirm "Move its database and settings here, and stop it there?"; then
      $SUDO mkdir -p data
      [ -d "$other/data" ] && $SUDO cp -a "$other/data/." data/
      [ -f "$other/.env" ] && $SUDO cp -a "$other/.env" .env
      [ -n "$SUDO" ] && $SUDO chown "$(id -u):$(id -g)" .env 2>/dev/null || true
      (cd "$other" && $DC down)
      info "Moved. The old folder is untouched apart from being stopped; delete it once you're happy."
    else
      die "Left as it is. Stop it ('cd $other && docker compose down') before installing here."
    fi
  fi
fi

# ---------------------------------------------------------------- settings
# The default for a question: a value passed in the environment, then what .env already has.
current() { local passed="${!1-}"; printf '%s' "${passed:-$(get_env "$1")}"; }

# This machine's time zone, e.g. Australia/Brisbane (Linux, WSL and Mac).
system_tz() {
  local tz=""
  tz="$(timedatectl show -p Timezone --value 2>/dev/null || true)"
  [ -n "$tz" ] || tz="$(readlink /etc/localtime 2>/dev/null | sed -n 's|.*zoneinfo/||p' || true)"
  [ -n "$tz" ] || tz="$(cat /etc/timezone 2>/dev/null || true)"
  [ -n "$tz" ] && printf '%s' "$tz"
}

configure() {
  # Inverters are connected in the dashboard (Manage → Integrations), and the array size and battery
  # are set there too (Manage → System). Ones passed in on a first install (INVERTER_HOST=... or
  # PV_KW=... bash install.sh --yes) are still taken, and moved into the databases when it starts.
  local v
  for v in INVERTER_HOST PV2_HOST PV2_BEHIND_METER PV_KW BATTERY_KWH; do
    [ -n "${!v-}" ] && set_env "$v" "${!v}"
  done
  local tz; tz="$(current TZ)"
  [ -n "$tz" ] && [ "$tz" != "$(get_env TZ .env.example)" ] || tz="$(system_tz || printf '%s' "$tz")"
  set_env TZ "$(ask "Time zone" "$tz")"
  set_env PORT "$(ask "Port to serve the dashboard on" "$(current PORT)")"
  info "Saved to .env. Inverters, array size, rates, location and system cost are set in the dashboard."
}

if [ ! -f .env ]; then
  say "First install: a few questions (press Enter to keep the suggestion)"
  (umask 077 && cp .env.example .env)  # yours alone, from the start (it'll hold COLLECTOR_TOKEN)
  configure
else
  # Keep the running app's settings: anything .env doesn't set (because it came from an older
  # version's defaults) is written into .env with the value the app is actually using.
  kept=""
  while IFS= read -r line; do
    [[ "$line" =~ ^[A-Z0-9_]+= ]] || continue
    key="${line%%=*}"
    grep -q "^$key=" .env && continue
    val="$(printf '%s\n' "$RUNNING_ENV" | sed -n "s/^$key=//p" | head -n 1)"
    [ -n "$val" ] || continue
    set_env "$key" "$val"; kept="$kept $key"
  done <.env.example
  [ -n "$kept" ] && info "Kept your running settings by writing them into .env:$kept"
  if [ "$CONFIGURE" = 1 ]; then
    say "Your settings (press Enter to keep each one)"
    configure
  fi
fi
# The secret the dashboard uses to read the collector's feed: made once, kept in .env.
if [ -z "$(get_env COLLECTOR_TOKEN)" ]; then
  set_env COLLECTOR_TOKEN "$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
  info "Generated COLLECTOR_TOKEN in .env (the dashboard uses it to read the collector)."
fi
mkdir -p data
PORT="$(get_env PORT)"; PORT="${PORT:-8080}"
# Your settings (.env holds COLLECTOR_TOKEN) and data are yours alone: no one else on this machine can read them.
# Only what's yours is changed; data/ may belong to the containers' own user, and is left as it is then.
[ -d "$BACKUPS" ] || mkdir "$BACKUPS" 2>/dev/null || true
[ -O .env ] && chmod 600 .env 2>/dev/null || true
for d in data "$BACKUPS"; do [ -O "$d" ] && chmod 700 "$d" 2>/dev/null || true; done

# ---------------------------------------------------------------- back up, then build and start
FROM_COMMIT="$(from_commit)"
FROM_VERSION="$(version_label "$FROM_COMMIT" "$WMP_FROM_CHANNEL")"
if [ "$BACKUP" = 0 ]; then
  warn "Not backing up the databases (--no-backup)."
elif ! backup_databases "$FROM_VERSION"; then
  die "Couldn't back up the databases (see above), so it stopped before rebuilding: the app is still the version it was. Check there's space (df -h $HERE/data). To update without a backup, run bash install.sh --no-backup."
fi

# ---------------------------------------------------------------- updates from the dashboard
# A cron job runs updater.sh every minute: it says it's there (so the dashboard offers "Update now"), and runs this
# script when the dashboard asks. Its folder is made here, as you, so it can write in it (the dashboard only adds a
# request to it).
mkdir -p data/update
if [ "$DASHBOARD_UPDATES" = 1 ]; then
  if ! command -v crontab >/dev/null 2>&1; then
    info "Updating from the dashboard needs cron, which isn't installed here: update with bash install.sh."
  elif ! crontab -l 2>/dev/null | grep -qF "$HERE/updater.sh"; then
    say "Setting up updates from the dashboard"
    { crontab -l 2>/dev/null | grep -vF "$CRON_TAG" || true; printf '* * * * * bash "%s/updater.sh" >/dev/null 2>&1 %s\n' "$HERE" "$CRON_TAG"; } | crontab - \
      && info "Manage → System → Updates can now update it. (bash install.sh --no-dashboard-updates turns this off.)" \
      || warn "Couldn't add the cron job, so updates are by bash install.sh only."
  fi
elif crontab -l 2>/dev/null | grep -qF "$CRON_TAG"; then
  crontab -l 2>/dev/null | grep -vF "$CRON_TAG" | crontab - && info "Updating from the dashboard is off."
fi

# ---------------------------------------------------------------- keep the version being replaced (for --rollback)
# Its images are tagged :previous, and its commit, version and backup noted in data/update/previous. Only when the
# version changes: rebuilding the same one keeps what's there. The images replaced are removed once the new ones are up.
OLD_IMAGES="$(running_images | awk '{ print $2 }')"
if [ -n "$FROM_COMMIT" ] && [ "$FROM_COMMIT" != "$(git rev-parse HEAD 2>/dev/null || true)" ] && [ -n "$OLD_IMAGES" ]; then
  names=""
  while read -r name id; do
    [ -n "$id" ] || continue
    name="${name%:latest}"
    OLD_IMAGES="$OLD_IMAGES $($DOCKER image inspect -f '{{.Id}}' "$name:previous" 2>/dev/null || true)"
    $DOCKER tag "$id" "$name:previous" && names="$names $name"
  done <<<"$(running_images)"
  if printf 'commit=%s\nversion=%s\nbackup=%s\nimages=%s\nwhen=%s\n' "$FROM_COMMIT" "$FROM_VERSION" "$BACKUP_MADE" \
    "${names# }" "$(date '+%-d %b %Y, %H:%M')" >"$PREVIOUS.tmp" && mv -f "$PREVIOUS.tmp" "$PREVIOUS"; then
    info "Kept $FROM_VERSION, to go back to with bash install.sh --rollback if this one gives you trouble."
  else
    warn "Couldn't note the version it replaces in $PREVIOUS, so --rollback can't go back to it."
  fi
fi

say "Building and starting"
bluetooth_setup
# The commit goes into the dashboard's image, so it can tell when GitHub has a newer version. A build argument rather
# than the environment, which sudo would leave behind.
$DC build --build-arg "GIT_COMMIT=$(git rev-parse HEAD 2>/dev/null || true)"
$DC up -d --remove-orphans
STOPPED=0

# The images replaced (and the :previous ones they replaced), and this app's build leftovers. Only this app's own:
# anything else on this machine is left alone.
# shellcheck disable=SC2086  # a list of image IDs
drop_unnamed $OLD_IMAGES
project="$($DOCKER inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' "$APP" 2>/dev/null || true)"
[ -z "$project" ] || $DOCKER image prune -f --filter "label=com.docker.compose.project=$project" >/dev/null 2>&1 || true
wait_and_report
