#!/bin/sh
# Publish a built dist/ into the deployment root with an atomic swap.
#
#   scripts/publish-dist.sh <dist-dir> <release-id>
#
# The layout matches the other sites on this host:
#
#   releases/<release-id>/   one immutable copy of a build
#   html -> releases/...     the symlink the web server serves
#   .deploy.lock             serialises concurrent publishes
#
# The symlink is written under a temporary name and then renamed over
# `html`, so a request either sees the previous release or the new one and
# never a half-copied tree.
set -eu

src="${1:-}"
release_id="${2:-}"

if [ -z "$src" ] || [ ! -d "$src" ]; then
  echo "usage: $0 <dist-dir> <release-id>" >&2
  exit 1
fi
if [ -z "$release_id" ]; then
  echo "release id is required" >&2
  exit 1
fi
# The id becomes a directory name, so keep it to an unambiguous alphabet.
case "$release_id" in
  *[!A-Za-z0-9._-]*)
    echo "release id may only contain A-Z a-z 0-9 . _ -: $release_id" >&2
    exit 1
    ;;
esac

deploy="${DEPLOY_ROOT:-/deploy}"
releases="$deploy/releases"
target="$releases/$release_id"
link="$deploy/html"
lock="$deploy/.deploy.lock"

mkdir -p "$releases"

# Serialise publishes. `concurrency: limit 1` in the pipeline already
# prevents two pipelines, but a manual run can overlap a queue drain.
exec 9>"$lock"
if ! flock -w 300 9; then
  echo "could not acquire $lock within 300s" >&2
  exit 1
fi

# Copy into place first. The release directory is only referenced once the
# copy is complete, so an interrupted publish leaves the live site alone.
rm -rf "$target"
cp -R "$src" "$target"

# A real directory at `html` predates the symlink layout; move it aside
# rather than deleting someone's files.
if [ -d "$link" ] && [ ! -L "$link" ]; then
  legacy="$deploy/legacy-$(date +%Y%m%d%H%M%S)"
  mv "$link" "$legacy"
  echo "moved existing directory to $legacy" >&2
fi

# Rename a sibling symlink over `html`. rename(2) within one directory is
# atomic, which is what makes the swap invisible to a request in flight.
staging="$deploy/.html.$$"
ln -sfn "releases/$release_id" "$staging"
mv -T "$staging" "$link"

echo "published $release_id"

# Drop releases that are no longer reachable. The newest ones are kept in
# case a rollback is needed.
keep="${KEEP_RELEASES:-5}"
ls -1dt "$releases"/* 2>/dev/null | tail -n "+$((keep + 1))" | while read -r old; do
  [ "$old" = "$target" ] && continue
  rm -rf "$old"
done
