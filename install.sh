#!/usr/bin/env bash
# Install or update WattsMyPower with Docker.
#
#   Install:  curl -fsSL https://raw.githubusercontent.com/KlemmyDev/WattsMyPower/main/install.sh | bash
#   Update:   cd wattsmypower && bash install.sh
#
# Run from anywhere other than a WattsMyPower folder, it downloads WattsMyPower into
# ./wattsmypower (installing git first if needed) and carries on from there. Run inside
# that folder, it updates it.
#
# Your data (data/) and settings (.env) are never overwritten. Before each update
# the database is backed up to data/backups/ (the newest 5 are kept), without
# stopping the app.
#
# Options:  --configure  change your settings (time zone, port), then restart. Your current
#                        values are the defaults. Inverters are connected, and the array size
#                        set, in the dashboard: Settings → Integrations and Settings → System.
#           --start      just start it (and Docker if needed): no update, rebuild or
#                        questions. start.sh does the same.
#           -y, --yes    accept the defaults and don't ask anything. Settings can also be
#                        passed in, e.g. TZ=Australia/Perth bash install.sh --yes, and on a first
#                        install PV_KW=10 or INVERTER_HOST=... to set up without the dashboard
#           -h, --help   show this help
#
# First install only:  WMP_DIR=/path  folder to install into (default: ./wattsmypower)
set -euo pipefail

APP=wattsmypower
REPO=https://github.com/KlemmyDev/WattsMyPower.git

YES=0
PULL=1
CONFIGURE=0
START=0
HELP=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) YES=1 ;;
    --configure) CONFIGURE=1 ;;
    --start) START=1; PULL=0 ;;
    --no-pull) PULL=0 ;;  # internal: used when the script restarts itself after updating
    -h|--help) HELP=1 ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

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

SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi

# ---------------------------------------------------------------- find (or download) the app
# This script's own folder, when it's being run from a file rather than piped in from curl.
SELF_DIR=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; fi
is_app() { [ -f "$1/docker-compose.yml" ] && [ -d "$1/app" ] && [ -f "$1/install.sh" ]; }

if [ "$HELP" = 1 ]; then
  if [ -n "$SELF_DIR" ]; then sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  else echo "Usage: curl -fsSL https://raw.githubusercontent.com/KlemmyDev/WattsMyPower/main/install.sh | bash [-s -- --yes]"; fi
  exit 0
fi

if [ -z "$SELF_DIR" ] || ! is_app "$SELF_DIR"; then
  DIR="${WMP_DIR:-$(pwd)/wattsmypower}"
  if is_app "$DIR"; then
    say "WattsMyPower is already in $DIR: updating it"
  else
    [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ] && die "$DIR already exists and isn't a WattsMyPower folder. Move it, or choose another folder with WMP_DIR=/path."
    if ! command -v git >/dev/null 2>&1; then
      warn "git is needed to download WattsMyPower and to update it later."
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

# ---------------------------------------------------------------- update the code
if [ "$PULL" = 1 ] && [ -d .git ]; then
  say "Getting the latest version"
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    git status --short --untracked-files=no
    die "These files have local changes, so the update would overwrite them. Commit or undo them (git checkout -- <file>) and run this again."
  fi
  before="$(git rev-parse HEAD)"
  git pull --ff-only
  if [ "$(git rev-parse HEAD)" = "$before" ]; then
    info "Already up to date ($(git log -1 --format='%h, %cd' --date=short))."
  else
    git log --oneline "$before..HEAD" | sed 's/^/  /'
    # This script may itself have changed: carry on with the new version.
    if ! git diff --quiet "$before" HEAD -- install.sh; then exec bash "$HERE/install.sh" --no-pull "$@"; fi
  fi
fi

# ---------------------------------------------------------------- Docker
say "Checking Docker"
if ! command -v docker >/dev/null 2>&1; then
  warn "Docker isn't installed."
  if confirm "Install it now with Docker's official install script (get.docker.com)?"; then
    command -v curl >/dev/null 2>&1 || die "curl is needed to download it: run 'apt install curl' and try again."
    curl -fsSL https://get.docker.com | $SUDO sh
  else
    die "Install Docker (https://docs.docker.com/engine/install/) and run this again."
  fi
fi
DOCKER="docker"
docker_ok() { docker info >/dev/null 2>&1 || { [ -n "$SUDO" ] && $SUDO docker info >/dev/null 2>&1; }; }
if command -v systemctl >/dev/null 2>&1; then
  # Start Docker if it isn't running, and have it start at boot so the app comes back after a restart.
  if ! docker_ok; then info "Starting Docker"; $SUDO systemctl start docker || true; fi
  if [ "$(systemctl is-enabled docker 2>/dev/null)" != enabled ]; then $SUDO systemctl enable docker >/dev/null 2>&1 && info "Docker will now start at boot." || true; fi
fi
if ! docker info >/dev/null 2>&1; then
  if [ -n "$SUDO" ] && $SUDO docker info >/dev/null 2>&1; then DOCKER="$SUDO docker"
  else die "Docker is installed but isn't running, or this user can't use it. Start it (systemctl start docker) or run this as root."; fi
fi
if $DOCKER compose version >/dev/null 2>&1; then DC="$DOCKER compose"
elif command -v docker-compose >/dev/null 2>&1; then DC="${SUDO:+$SUDO }docker-compose"
else die "Docker Compose isn't available. Install the compose plugin (apt install docker-compose-plugin) and run this again."; fi
info "$($DOCKER --version)"
# Wait until the app answers, then show where it is.
wait_and_report() {
  local ok=0 ip
  info "Waiting for it to respond..."
  for _ in $(seq 1 45); do
    if $DOCKER exec "$APP" python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/healthz', timeout=3)" >/dev/null 2>&1; then ok=1; break; fi
    sleep 2
  done
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if [ "$ok" = 1 ]; then
    local port; port="$(get_env PORT)"
    say "WattsMyPower is running: http://${ip:-localhost}:${port:-8080}"
    info "New install? Connect your inverter there: Settings → Integrations finds it on your network."
    info "Logs: $DC logs -f --tail=50"
  else
    warn "It started but isn't responding yet. Recent logs:"
    $DC logs --tail=30
    exit 1
  fi
}

if [ "$START" = 1 ]; then
  [ -f .env ] || die "WattsMyPower isn't installed in this folder yet: run bash install.sh first."
  say "Starting WattsMyPower"
  $DC up -d
  wait_and_report
  exit 0
fi

# What the running app was started with, so updates keep its settings (see below).
RUNNING_ENV="$($DOCKER inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$APP" 2>/dev/null || true)"

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

configure() {
  # Inverters are connected in the dashboard (Settings → Integrations), and the array size and battery
  # are set there too (Settings → System). Ones passed in on a first install (INVERTER_HOST=... or
  # PV_KW=... bash install.sh --yes) are still taken, and moved into the databases when it starts.
  local v
  for v in INVERTER_HOST PV2_HOST PV2_BEHIND_METER PV_KW BATTERY_KWH; do
    [ -n "${!v-}" ] && set_env "$v" "${!v}"
  done
  local tz; tz="$(current TZ)"
  [ -n "$tz" ] && [ "$tz" != "$(get_env TZ .env.example)" ] || tz="$(cat /etc/timezone 2>/dev/null || timedatectl show -p Timezone --value 2>/dev/null || printf '%s' "$tz")"
  set_env TZ "$(ask "Time zone" "$tz")"
  set_env PORT "$(ask "Port to serve the dashboard on" "$(current PORT)")"
  info "Saved to .env. Inverters, array size, rates, location and system cost are set in the dashboard."
}

if [ ! -f .env ]; then
  say "First install: a few questions (press Enter to keep the suggestion)"
  cp .env.example .env
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

# ---------------------------------------------------------------- back up, then build and start
if $DOCKER ps --format '{{.Names}}' | grep -qx "$APP"; then
  say "Backing up the databases"
  # SQLite's online backup, run inside the container: safe while the app keeps recording.
  $DOCKER exec "$APP" python - <<'PY'
import glob, os, sqlite3, time
os.makedirs("/data/backups", exist_ok=True)
stamp = time.strftime("%Y%m%d-%H%M%S")
for name in ("wattsmypower", "collector"):  # the dashboard's database, and the collector's raw readings
    path = f"/data/{name}.db"
    if not os.path.exists(path):
        continue
    dest = f"/data/backups/{name}-{stamp}.db"
    src, dst = sqlite3.connect(path), sqlite3.connect(dest)
    src.backup(dst)
    dst.close(); src.close()
    for old in sorted(glob.glob(f"/data/backups/{name}-*.db"))[:-5]:  # keep the newest 5 of each
        os.remove(old)
    print("  data/backups/" + os.path.basename(dest))
PY
fi

say "Building and starting"
$DC up -d --build --remove-orphans

$DOCKER image prune -f >/dev/null 2>&1 || true  # drop the previous build's image
wait_and_report
