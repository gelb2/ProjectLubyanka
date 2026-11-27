#!/usr/bin/env bash
set -euo pipefail
src=$(cd "$(dirname "$0")" && pwd)
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
cd "$fixture"
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
git init -q -b develop
git config user.name Tester
git config user.email tester@example.invalid
mkdir verification
cp "$src"/{branch-guard,install-branch-guard}.sh verification/
git add .
git commit -qm initial
git branch main
bash verification/install-branch-guard.sh
git switch -qc feature develop
echo first > data
git add data
git commit -qm feature
git switch -q main
if git merge --no-ff feature -m 'wrong source' >/dev/null 2>&1; then exit 1; fi
git reset -q --hard HEAD
git switch -q develop
git merge -q --no-ff feature -m integrated
if git branch bad-start main >/dev/null 2>&1; then exit 1; fi
git branch next-feature develop
git switch -q main
git merge -q --no-ff develop -m promotion
test "$(git rev-parse 'main^{tree}')" = "$(git rev-parse 'develop^{tree}')"
echo 'Branch checks passed: rejected direct feature promotion and off-main development, accepted develop promotion.'
