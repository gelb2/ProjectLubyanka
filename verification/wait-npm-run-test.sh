#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")" && pwd)
fixture=$(mktemp -d)
trap 'rm -rf "$fixture"' EXIT
export EVENTS="$fixture/events"
export PATH="$fixture:$PATH"
cat > "$fixture/gh" <<'FAKE'
#!/usr/bin/env bash
set -eu
test "$1 $2" = 'api repos/owner/project/actions/runs/7'
event=$(head -1 "$EVENTS")
tail -n +2 "$EVENTS" > "$EVENTS.next"
mv "$EVENTS.next" "$EVENTS"
case "$event" in unavailable|'') exit 1 ;; esac
printf '%s\n' "$event" | tr ' ' '\t'
FAKE
printf '#!/bin/sh\nexit 0\n' > "$fixture/sleep"
chmod +x "$fixture/gh" "$fixture/sleep"
check() { bash "$root/wait-npm-run.sh" owner/project 7 expected; }
printf '%s\n' unavailable 'expected queued pending' 'expected completed success' > "$EVENTS"
check
for event in 'expected completed failure' 'other completed success' unavailable; do
  printf '%s\n' "$event" > "$EVENTS"
  if check; then echo "예상 밖의 성공 · $event" >&2; exit 1; fi
done
