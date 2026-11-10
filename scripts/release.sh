#!/usr/bin/env bash
# Cut a release: bump package.json, commit, tag vX.Y.Z and push.
# The Release workflow then builds the zips and publishes the GitHub release.
# Usage: scripts/release.sh patch|minor|major|X.Y.Z [--dry-run]
set -euo pipefail
cd "$(dirname "$0")/.."

BUMP="${1:-}"; DRY=false
[ "${2:-}" = "--dry-run" ] && DRY=true
case "$BUMP" in
  patch|minor|major) ;;
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "Usage: scripts/release.sh patch|minor|major|X.Y.Z [--dry-run]" >&2; exit 2;;
esac

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "main" ] || { echo "Release from main, not $branch." >&2; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "Commit or stash tracked changes first." >&2; exit 1; }
git fetch --quiet origin main --tags
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "Local main differs from origin/main. Pull or push first." >&2; exit 1; }

current="$(node -p "require('./package.json').version")"
next="$(node -e '
  const [cur, bump] = process.argv.slice(1);
  if (/^\d+\.\d+\.\d+/.test(bump)) { console.log(bump); process.exit(0); }
  let [a, b, c] = cur.split("-")[0].split(".").map(Number);
  if (bump === "major") { a++; b = 0; c = 0; }
  else if (bump === "minor") { b++; c = 0; }
  else { c++; }
  console.log(`${a}.${b}.${c}`);
' "$current" "$BUMP")"
tag="v$next"

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "Tag $tag already exists." >&2; exit 1
fi

last="$(git describe --tags --abbrev=0 --match 'v[0-9]*' 2>/dev/null || true)"
echo "Release $current -> $next ($tag)"
echo "Commits since ${last:-the first commit}:"
git --no-pager log --oneline ${last:+$last..}HEAD
if $DRY; then echo "Dry run: nothing changed."; exit 0; fi

read -r -p "Tag and push $tag? [y/N] " ok
case "$ok" in y|Y) ;; *) echo "Stopped."; exit 1;; esac

if [ "$next" != "$current" ]; then
  node -e '
    const fs = require("fs");
    const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
    pkg.version = process.argv[1];
    fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
  ' "$next"
  git add package.json
  git commit -m "chore: release $tag"
fi
git tag -a "$tag" -m "Uzero $tag"
git push origin main "$tag"
echo "Pushed $tag. Follow the build with: gh run watch"
