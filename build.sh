#!/usr/bin/env bash
# Builds the zip to upload to the Chrome Web Store: dist/file-navigator-<version>.zip.
# Made from the committed files (git archive), leaving out what .gitattributes
# marks export-ignore (tests, test files, store assets, ...).
set -euo pipefail
cd "$(dirname "$0")"

if [ -n "$(git status --porcelain)" ]; then
  echo "Uncommitted changes; commit them first so the zip matches the repository." >&2
  exit 1
fi

version=$(sed -n 's/^ *"version": "\(.*\)",$/\1/p' manifest.json)
out="dist/file-navigator-$version.zip"
mkdir -p dist
git archive --format=zip -o "$out" HEAD
echo "$out"
unzip -l "$out" | tail -n +4 | head -n -2 | awk '{print "  " $4}'
