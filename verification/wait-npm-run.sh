#!/usr/bin/env bash
set -euo pipefail
repo=$1 run=$2 expected=$3
failures=0
for ((poll=0; poll<720; poll++)); do
  if record=$(gh api "repos/$repo/actions/runs/$run" --jq '[.head_sha,.status,(.conclusion // "pending")] | @tsv'); then
    failures=0
    IFS=$'\t' read -r sha status conclusion <<< "$record"
    if [[ "$sha" != "$expected" ]]; then echo '게시 실행의 커밋이 후보와 다릅니다.' >&2; exit 1; fi
    if [[ "$status" == completed ]]; then
      echo "npm 게시 실행 $run · $conclusion"
      [[ "$conclusion" == success ]]
      exit
    fi
  else
    failures=$((failures+1))
    if ((failures >= 12)); then echo "게시 실행 $run 조회 실패" >&2; exit 1; fi
  fi
  sleep 5
done
echo "게시 실행 $run 대기 시간 초과" >&2
exit 1
