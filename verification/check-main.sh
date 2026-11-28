#!/usr/bin/env bash
# Accept detached Actions checkouts and local main only at the same remote merge.
set -euo pipefail
refs=$(git ls-remote --exit-code origin refs/heads/main refs/heads/develop)
main=$(awk '$2=="refs/heads/main" {print $1}' <<< "$refs")
develop=$(awk '$2=="refs/heads/develop" {print $1}' <<< "$refs")
test -n "$main" && test -n "$develop"
test "$(git rev-parse HEAD)" = "$main"
test "$(git show -s --format=%P HEAD)" = "$(git rev-parse HEAD^1) $develop"
test "$(git rev-parse 'HEAD^{tree}')" = "$(git rev-parse "$develop^{tree}")"
