#!/usr/bin/env bash
set -euo pipefail
archive=$1
registry=https://registry.npmjs.org/
name=lubyanka-oracle-scaffold
pkg=./notes-research/oracle-scaffold/package.json
test "$(node -p "require('$pkg').name")" = "$name"
version=$(node -p "require('$pkg').version")
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]
test "$GITHUB_REF" = refs/heads/main
test "$GITHUB_SHA" = "$(git rev-parse HEAD)"
test "$GITHUB_REPOSITORY" = gelb2/ProjectLubyanka
bash verification/check-main.sh
statuses="$RUNNER_TEMP/candidate-statuses.json"
gh api --paginate --slurp "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/statuses?per_page=100" > "$statuses"
expected=$(node verification/npm-candidate.mjs "$archive" "$statuses")
versions=$(npm view "$name" versions --json --prefer-online --registry="$registry")
exists=$(jq -er --arg v "$version" '
  (if type == "string" then [.] else . end)
  | if type != "array" or any(.[]; type != "string") then error("Invalid npm versions") else . end
  | if index($v) == null then "new" else "published" end' <<< "$versions")
if [[ "$exists" == new ]]; then
  # Supply no npm token. The npm CLI authenticates this hosted job with OIDC.
  npm publish "$archive" --access public --tag latest --ignore-scripts --registry="$registry"
fi
# A successful publish can precede public registry visibility.
for attempt in {1..60}; do
  metadata=$(npm view "$name@$version" dist --json --prefer-online --registry="$registry") && break
  sleep 5
done
test "$(jq -r .integrity <<< "$metadata")" = "$expected"
test "$(jq -r .attestations.provenance.predicateType <<< "$metadata")" = 'https://slsa.dev/provenance/v1'
test "$(npm view "$name" dist-tags.latest --prefer-online --registry="$registry")" = "$version"
fresh=$(mktemp -d)
(cd "$fresh" && npm install --save-exact --ignore-scripts --no-fund --no-audit --registry="$registry" "$name@$version")
node verification/endpoint-install.mjs "$fresh"
(cd "$fresh" && node --input-type=module -e "import { evaluateOracle } from 'lubyanka-oracle-scaffold'; if (typeof evaluateOracle !== 'function') process.exit(1)")
