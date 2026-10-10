#!/usr/bin/env bash
# Set the version (pyproject.toml, and uv.lock beside it) to today's date in Brisbane: 2026.10.10. The Version workflow
# runs it on every merge to main, so the version is always the day of the last change; run it by hand to see.
#
#   scripts/version.sh          set it, if it's from an earlier day; prints the version either way
#   scripts/version.sh --check  only say whether it's today's (exit 1 if not)
#
# A version already on today's date is left alone, including a second release that day (2026.10.10.1, set by hand
# before releasing it, as a stable release's tag can only be used once).
set -euo pipefail

cd "$(dirname "$0")/.."
CHECK=0
case "${1:-}" in
  "") ;;
  --check) CHECK=1 ;;
  -h|--help) sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
  *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
esac

TODAY="$(TZ=Australia/Brisbane date +%Y.%-m.%-d)"
CURRENT="$(sed -n 's/^version = "\(.*\)"$/\1/p' pyproject.toml | head -n 1)"
[[ "$CURRENT" =~ ^[0-9]+(\.[0-9]+)*$ ]] || { echo "Couldn't read the version from pyproject.toml." >&2; exit 1; }

# Its date (the first three numbers), as one number to compare: 2026.10.9.1 → 20261009.
day() { IFS=. read -r y m d _ <<<"$1"; printf '%04d%02d%02d' "$y" "${m:-0}" "${d:-0}"; }

if [ "$(day "$CURRENT")" -ge "$(day "$TODAY")" ]; then
  echo "$CURRENT"
  exit 0
fi
if [ "$CHECK" = 1 ]; then
  echo "$CURRENT is from an earlier day than today ($TODAY)." >&2
  exit 1
fi

# pyproject.toml's first `version =` is the project's; in uv.lock it's the line after the project's own name.
tmp="$(mktemp)"
awk -v v="$TODAY" '!done && /^version = "/ { $0 = "version = \"" v "\""; done = 1 } { print }' pyproject.toml >"$tmp"
cat "$tmp" >pyproject.toml
awk -v v="$TODAY" 'mine && /^version = "/ { $0 = "version = \"" v "\"" } { mine = ($0 == "name = \"wattsmypower\"") } { print }' \
  uv.lock >"$tmp"
cat "$tmp" >uv.lock
rm -f "$tmp"
echo "$TODAY"
