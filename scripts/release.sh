#!/usr/bin/env bash
# Publish a release, for installs following the beta or stable channel (Manage → System → Updates; nightly follows
# main as it's merged and needs nothing).
#
#   scripts/release.sh beta                       the latest on main, as a pre-release: v2026.10.10-beta (-beta.2…)
#   scripts/release.sh stable                     the latest on main, as a release: v2026.10.10
#   scripts/release.sh stable v2026.10.10-beta    a beta that's been tried, promoted to a release
#
# The version is the commit's own (pyproject.toml): bump it, and merge that, before a stable release of new changes, as
# a stable release's tag can only be used once. Releases are only made from commits on main. It tags the commit, pushes
# the tag, and makes a GitHub release of it with the changes since the channel's last release (with gh, if it's there).
# Installs on the channel pick it up at their next check, within a few hours.
#
# Options:  -y, --yes     don't ask before publishing
#           --tag-only    push the tag without making a GitHub release (the channels only need the tag)
#           -h, --help    show this help
set -euo pipefail

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

CHANNEL=""
REF=""
YES=0
GITHUB=1
for arg in "$@"; do
  case "$arg" in
    -y|--yes) YES=1 ;;
    --tag-only) GITHUB=0 ;;
    -h|--help) awk 'NR > 1 && /^set -euo/ { exit } NR > 1' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "Unknown option: $arg (try --help)" ;;
    *) if [ -z "$CHANNEL" ]; then CHANNEL="$arg"; elif [ -z "$REF" ]; then REF="$arg"; else die "Too many arguments (try --help)"; fi ;;
  esac
done
case "$CHANNEL" in beta|stable) ;; "") die "Which channel: scripts/release.sh beta, or scripts/release.sh stable (try --help)" ;; *) die "There's no '$CHANNEL' channel to release to: it's beta or stable (nightly is main)." ;; esac

cd "$(git rev-parse --show-toplevel)"
git fetch --quiet --tags --force origin main || die "Couldn't fetch from origin."
REF="${REF:-origin/main}"
COMMIT="$(git rev-parse --verify --quiet "$REF^{commit}")" || die "$REF isn't a commit here."
git merge-base --is-ancestor "$COMMIT" origin/main || die "$REF isn't on main: releases are only made from main."

VERSION="$(git show "$COMMIT:pyproject.toml" | sed -n 's/^version = "\(.*\)"$/\1/p' | head -n 1)"
[[ "$VERSION" =~ ^[0-9]+(\.[0-9]+)*$ ]] || die "Couldn't read the version from $REF's pyproject.toml."

exists() { git rev-parse --verify --quiet "refs/tags/$1" >/dev/null; }
if [ "$CHANNEL" = stable ]; then
  TAG="v$VERSION"
  if exists "$TAG"; then
    [ "$(git rev-parse "$TAG^{commit}")" = "$COMMIT" ] && die "$TAG is already released, on this commit."
    die "$TAG is already released, on another commit: bump the version in pyproject.toml (and merge that) first."
  fi
else
  TAG="v$VERSION-beta"
  n=1
  while exists "$TAG"; do
    [ "$(git rev-parse "$TAG^{commit}")" = "$COMMIT" ] && die "$TAG is already this commit."
    n=$((n + 1)); TAG="v$VERSION-beta.$n"
  done
fi

# The channel's release before this one (beta follows stable releases too), for the changes since.
pattern='^v[0-9]+(\.[0-9]+)*(-[0-9A-Za-z.]+)?$'
[ "$CHANNEL" = stable ] && pattern='^v[0-9]+(\.[0-9]+)*$'
PREVIOUS="$(git -c versionsort.suffix=- tag -l 'v[0-9]*' --sort=-v:refname | grep -E "$pattern" | head -n 1 || true)"

say "Releasing $TAG on $CHANNEL"
info "Commit:   $(git log -1 --format='%h %s' "$COMMIT")"
if [ -n "$PREVIOUS" ]; then
  if git merge-base --is-ancestor "$PREVIOUS" "$COMMIT"; then
    info "Since $PREVIOUS:"
    git log --oneline --first-parent "$PREVIOUS..$COMMIT" | sed 's/^/    /'
  else
    info "This is older than $PREVIOUS, the channel's newest, so installs on it won't move to it."
  fi
else
  info "The first release on $CHANNEL."
fi
if [ "$YES" = 0 ]; then
  read -r -p "  Publish it? [y/N] " answer
  [[ "$answer" =~ ^[Yy] ]] || die "Nothing was published."
fi

label="WattsMyPower $VERSION"
[ "$CHANNEL" = beta ] && label="$label (beta)"
git tag -a "$TAG" "$COMMIT" -m "$label"
git push --quiet origin "refs/tags/$TAG" || { git tag -d "$TAG" >/dev/null; die "Couldn't push $TAG, so it's been taken back here too."; }
info "Pushed $TAG."

if [ "$GITHUB" = 1 ]; then
  if ! command -v gh >/dev/null 2>&1; then
    info "gh isn't installed, so there's no GitHub release page (the channels only need the tag)."
  else
    args=(--verify-tag --generate-notes --title "$label")
    [ -n "$PREVIOUS" ] && args+=(--notes-start-tag "$PREVIOUS")
    if [ "$CHANNEL" = beta ]; then args+=(--prerelease --latest=false); else args+=(--latest); fi
    gh release create "$TAG" "${args[@]}" || die "$TAG is pushed (installs will find it), but the GitHub release couldn't be made: gh release create $TAG --generate-notes"
  fi
fi
say "Released $TAG: installs on $CHANNEL pick it up at their next check."
