#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in ''|--publish) ;; *) echo 'usage: bash verification/main-release.sh [--publish]' >&2; exit 2 ;; esac
root=$(git rev-parse --show-toplevel)
cd "$root"
check_main() {
  test "$(git symbolic-ref --short HEAD)" = main
  test -z "$(git status --porcelain)"
  bash verification/check-main.sh
}
check_main
candidate=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$candidate"' EXIT
mkdir "$candidate/source"
git archive --format=tar HEAD | tar -xf - -C "$candidate/source"
cd "$candidate/source"
pkg=notes-research/oracle-scaffold
name=$(node -p "require('./$pkg/package.json').name")
version=$(node -p "require('./$pkg/package.json').version")
(tarball_dir="$candidate"; cd "$pkg"; npm pack --offline --ignore-scripts --pack-destination "$tarball_dir" --silent)
archive="$candidate/$name-$version.tgz"
hash_file() { node -e "const fs=require('node:fs'),c=require('node:crypto');console.log(c.createHash('sha512').update(fs.readFileSync(process.argv[1])).digest('base64'))" "$1"; }
digest=$(hash_file "$archive")
bash verification/wait-npm-run-test.sh
node --test verification/npm-candidate.test.mjs
bash verification/branch-route-test.sh
npm --prefix "$pkg" test --offline
node verification/standalone.mjs
node verification/release.mjs "$archive"
mkdir "$candidate/live"
(cd "$candidate/live"; npm install --offline --ignore-scripts --no-fund --no-audit "$archive")
node verification/live-caption.mjs "$candidate/live/node_modules/.bin/lubyanka" "${LUBYANKA_TEST_IMAGE:-node:22-bookworm-slim}"
test "$(hash_file "$archive")" = "$digest"
cd "$root"
check_main
echo "VERIFIED $name@$version $(git rev-parse HEAD) sha512-$digest"
if [[ ${1:-} == --publish ]]; then
  repo=gelb2/ProjectLubyanka
  head=$(git rev-parse HEAD)
  owner=$(gh api "repos/$repo" --jq .owner.id)
  test "$(gh api user --jq .id)" = "$owner"
  gh api --silent "repos/$repo/statuses/$head" -f state=success \
    -f context=release/installed-candidate -f description="sha512-$digest"
  run=$(gh api -H 'X-GitHub-Api-Version: 2026-03-10' \
    "repos/$repo/actions/workflows/npm-publish.yml/dispatches" -f ref=main --jq .workflow_run_id)
  [[ "$run" =~ ^[0-9]+$ ]]
  echo "https://github.com/$repo/actions/runs/$run"
  bash verification/wait-npm-run.sh "$repo" "$run" "$head"
  echo "RELEASED $name@$version sha512-$digest"
fi
