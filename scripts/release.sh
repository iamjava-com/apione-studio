#!/usr/bin/env bash
# Prepare a release: bump the three package versions, verify, commit, tag.
#
# It stops short of pushing: the tag is what starts the publish. The command is printed at the end.
#
# Usage: scripts/release.sh 0.1.0
set -euo pipefail

version=${1:?a version, e.g. 0.1.0}
[[ $version =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || {
  echo "not a semver version: $version" >&2
  exit 1
}

cd "$(dirname "${BASH_SOURCE[0]}")/.."

[ -z "$(git status --porcelain)" ] || {
  echo "the working tree has changes — commit or stash them first" >&2
  exit 1
}
git rev-parse -q --verify "refs/tags/v$version" >/dev/null && {
  echo "v$version already exists" >&2
  exit 1
}

npm run verify

# `npm version` rather than an edit in place: it carries the number into package-lock.json too.
for pkg in . apps/server apps/web; do
  npm --prefix "$pkg" version "$version" --no-git-tag-version >/dev/null
done

git commit -aqm "chore(release): v$version"
git tag "v$version"

echo
echo "v$version is committed and tagged. Nothing has left this machine yet."
echo "Publish it with:"
echo
echo "    git push origin main v$version"
