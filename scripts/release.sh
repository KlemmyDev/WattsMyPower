#!/usr/bin/env bash
# Publish a release, for installs following the beta or stable channel (Manage → System → Updates; nightly follows
# main as it's merged and needs nothing).
#
#   scripts/release.sh beta                       the latest on main, as a pre-release: v2026.10.10-beta (-beta.2…)
#   scripts/release.sh stable                     the latest on main, as a release: v2026.10.10
#   scripts/release.sh stable v2026.10.10-beta    a beta that's been tried, promoted to a release
#
# The version is the commit's own (pyproject.toml): the date of its last change, in Brisbane, kept up to date on main by
# the Version workflow (scripts/version.sh). A stable release's tag can only be used once, so a second stable release
# on the same day needs the version set to 2026.10.10.1 by hand (and merged) first. Releases are only made from
# commits on main whose CI (the GitHub Actions workflow named CI) has passed. It tags the commit, pushes the tag, and
# makes a GitHub release of it with the changes since the channel's last release (with gh, if it's there). The first release on a channel has no last
# release to start from, so its notes are --notes-file's, or a short note pointing at CHANGELOG.md. Installs on the
# channel pick it up at their next check, within a few hours.
#
# Options:  -y, --yes     don't ask before publishing
#           --tag-only    push the tag without making a GitHub release (the channels only need the tag)
#           --notes-file <file>
#                         the GitHub release's notes, instead of the changes since the channel's last release
#           --skip-ci     release without CI having passed on the commit (when GitHub can't be asked, say)
#           -h, --help    show this help
set -euo pipefail

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

CHANNEL=""
REF=""
YES=0
GITHUB=1
CI=1
NOTES=""
want_notes=0
for arg in "$@"; do
  if [ "$want_notes" = 1 ]; then NOTES="$arg"; want_notes=0; continue; fi
  case "$arg" in
    -y|--yes) YES=1 ;;
    --tag-only) GITHUB=0 ;;
    --notes-file) want_notes=1 ;;
    --notes-file=*) NOTES="${arg#--notes-file=}" ;;
    --skip-ci) CI=0 ;;
    -h|--help) awk 'NR > 1 && /^set -euo/ { exit } NR > 1' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "Unknown option: $arg (try --help)" ;;
    *) if [ -z "$CHANNEL" ]; then CHANNEL="$arg"; elif [ -z "$REF" ]; then REF="$arg"; else die "Too many arguments (try --help)"; fi ;;
  esac
done
[ "$want_notes" = 0 ] || die "--notes-file needs a file (try --help)"
case "$CHANNEL" in beta|stable) ;; "") die "Which channel: scripts/release.sh beta, or scripts/release.sh stable (try --help)" ;; *) die "There's no '$CHANNEL' channel to release to: it's beta or stable (nightly is main)." ;; esac
if [ -n "$NOTES" ]; then
  [ -f "$NOTES" ] || die "There's no notes file at $NOTES."
  NOTES="$(cd "$(dirname "$NOTES")" && pwd)/$(basename "$NOTES")"  # before moving to the top of the repository
fi

cd "$(git rev-parse --show-toplevel)"
git fetch --quiet --tags --force origin main || die "Couldn't fetch from origin."
REF="${REF:-origin/main}"
COMMIT="$(git rev-parse --verify --quiet "$REF^{commit}")" || die "$REF isn't a commit here."
git merge-base --is-ancestor "$COMMIT" origin/main || die "$REF isn't on main: releases are only made from main."

VERSION="$(git show "$COMMIT:pyproject.toml" | sed -n 's/^version = "\(.*\)"$/\1/p' | head -n 1)"
[[ "$VERSION" =~ ^[0-9]+(\.[0-9]+)*$ ]] || die "Couldn't read the version from $REF's pyproject.toml."
# A release label ([tool.wattsmypower] release, shown beside the version) has to agree with the channel: none on
# stable, and on beta none or "beta".
LABEL="$(git show "$COMMIT:pyproject.toml" | awk '/^\[/ { in_tool = ($0 == "[tool.wattsmypower]") } in_tool && /^release *=/' \
  | sed -n 's/^release *= *"\(.*\)".*$/\1/p' | head -n 1)"
if [ -n "$LABEL" ] && { [ "$CHANNEL" = stable ] || [ "$LABEL" != beta ]; }; then
  die "$REF's pyproject.toml labels it \"$LABEL\" ([tool.wattsmypower] release), which isn't a $CHANNEL release: remove the label (and merge that) first."
fi

# CI has to have passed on the commit: the newest run of the workflow named CI on it decides.
ci_failed() {
  warn "$1"
  [ "$2" = ask ] || die "Nothing was published. (--skip-ci releases it anyway.)"
  [ "$YES" = 0 ] || die "Nothing was published: with --yes it doesn't ask. (--skip-ci releases it anyway.)"
  read -r -p "  Release it anyway? [y/N] " answer
  [[ "$answer" =~ ^[Yy] ]] || die "Nothing was published."
}
CI_SAID="not checked (--skip-ci)"
if [ "$CI" = 1 ]; then
  CI_SAID="not checked"
  if ! command -v gh >/dev/null 2>&1; then
    ci_failed "gh isn't installed, so whether CI passed on $(git rev-parse --short "$COMMIT") can't be checked." ask
  elif ! ci="$(gh run list --workflow CI --commit "$COMMIT" --limit 1 --json status,conclusion \
      --jq 'if length == 0 then "none" elif .[0].status != "completed" then "running" else .[0].conclusion end' 2>&1)"; then
    ci_failed "Couldn't ask GitHub whether CI passed on $(git rev-parse --short "$COMMIT"): ${ci:-gh failed}" ask
  else
    case "$ci" in
      success) CI_SAID="passed" ;;
      none) ci_failed "CI hasn't run on $(git rev-parse --short "$COMMIT")." refuse ;;
      running) ci_failed "CI is still running on $(git rev-parse --short "$COMMIT"): wait for it to pass." refuse ;;
      *) ci_failed "CI didn't pass on $(git rev-parse --short "$COMMIT") ($ci)." refuse ;;
    esac
  fi
fi

exists() { git rev-parse --verify --quiet "refs/tags/$1" >/dev/null; }
if [ "$CHANNEL" = stable ]; then
  TAG="v$VERSION"
  if exists "$TAG"; then
    [ "$(git rev-parse "$TAG^{commit}")" = "$COMMIT" ] && die "$TAG is already released, on this commit."
    die "$TAG is already released, on another commit: set the version in pyproject.toml to $VERSION.1 (and merge that) first."
  fi
else
  TAG="v$VERSION-beta"
  n=1
  while exists "$TAG"; do
    [ "$(git rev-parse "$TAG^{commit}")" = "$COMMIT" ] && die "$TAG is already this commit."
    n=$((n + 1)); TAG="v$VERSION-beta.$n"
  done
fi

# The channel's release before this one (beta follows stable releases too), for the changes since. Only the tags made
# here count, in the order install.sh and the dashboard (app/features/updates/service.py) put them.
pattern='^v[0-9]+(\.[0-9]+)*(-beta(\.[0-9]+)?)?$'
[ "$CHANNEL" = stable ] && pattern='^v[0-9]+(\.[0-9]+)*$'
PREVIOUS="$(git -c versionsort.suffix=- tag -l 'v[0-9]*' --sort=-v:refname | grep -E "$pattern" | head -n 1 || true)"

say "Releasing $TAG on $CHANNEL"
info "Commit:   $(git log -1 --format='%h %s' "$COMMIT")"
info "CI:       $CI_SAID"
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
    args=(--verify-tag --title "$label")
    if [ -n "$NOTES" ]; then
      args+=(--notes-file "$NOTES")
    elif [ -n "$PREVIOUS" ]; then
      args+=(--generate-notes --notes-start-tag "$PREVIOUS")
    else
      # The first on the channel: generated notes would list every change ever made.
      args+=(--notes "The first $CHANNEL release of WattsMyPower. What's in it is in [CHANGELOG.md](https://github.com/$(gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || echo KlemmyDev/WattsMyPower)/blob/$TAG/CHANGELOG.md).")
    fi
    if [ "$CHANNEL" = beta ]; then args+=(--prerelease --latest=false); else args+=(--latest); fi
    gh release create "$TAG" "${args[@]}" || die "$TAG is pushed (installs will find it), but the GitHub release couldn't be made: gh release create $TAG"
  fi
fi
say "Released $TAG: installs on $CHANNEL pick it up at their next check."
