#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in ''|--publish) ;; *) echo 'usage: bash verification/main-release.sh [--publish]' >&2; exit 2 ;; esac
root=$(git rev-parse --show-toplevel)
cd "$root"
registry=https://registry.npmjs.org/
check_main() {
  test "$(git symbolic-ref --short HEAD)" = main
  test -z "$(git status --porcelain)"
  git fetch --quiet origin refs/heads/main refs/heads/develop
  local remote_refs develop main
  remote_refs=$(git ls-remote --exit-code origin refs/heads/develop refs/heads/main)
  develop=$(awk '$2=="refs/heads/develop" {print $1}' <<< "$remote_refs")
  main=$(awk '$2=="refs/heads/main" {print $1}' <<< "$remote_refs")
  test -n "$develop" && test -n "$main" || return 1
  test "$(git rev-parse HEAD)" = "$main" || return 1
  test "$(git show -s --format=%P HEAD)" = "$(git rev-parse HEAD^1) $develop" || return 1
  test "$(git rev-parse 'HEAD^{tree}')" = "$(git rev-parse "$develop^{tree}")" || return 1
}
# Keep the individual failures fatal even when callers wrap this script.
check_main
candidate=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$candidate"' EXIT
mkdir "$candidate/source" "$candidate/fresh"
git archive --format=tar HEAD | tar -xf - -C "$candidate/source"
cd "$candidate/source"
pkg=notes-research/oracle-scaffold
name=$(node -p "require('./$pkg/package.json').name")
version=$(node -p "require('./$pkg/package.json').version")
(tarball_dir="$candidate"; cd "$pkg"; npm pack --offline --ignore-scripts --pack-destination "$tarball_dir" --silent)
archive="$candidate/$name-$version.tgz"
hash_file() { node -e "const fs=require('node:fs'),c=require('node:crypto');console.log(c.createHash('sha512').update(fs.readFileSync(process.argv[1])).digest('base64'))" "$1"; }
digest=$(hash_file "$archive")
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
  published=$(npm view "$name" versions --json --prefer-online --registry="$registry")
  if node -e 'const value=JSON.parse(process.argv[1]); process.exit([].concat(value).includes(process.argv[2]) ? 0 : 1)' "$published" "$version"; then
    test "$(npm view "$name@$version" dist.integrity --prefer-online --registry="$registry")" = "sha512-$digest"
  else
    npm publish "$archive" --access public --tag latest --ignore-scripts --registry="$registry"
  fi
  (cd "$candidate/fresh"; npm install --save-exact --ignore-scripts --no-fund --no-audit --registry="$registry" "$name@$version")
  node verification/endpoint-install.mjs "$candidate/fresh"
  expected="sha512-$digest"
  test "$(npm view "$name@$version" dist.integrity --registry="$registry")" = "$expected"
  (cd "$candidate/fresh"; node --input-type=module -e "import {evaluateOracle} from 'lubyanka-oracle-scaffold'; if (typeof evaluateOracle !== 'function') process.exit(1)")
  echo "RELEASED $name@$version $expected"
fi
