#!/bin/sh
# Git reference-transaction runs before refs change. Preserve unrelated refs.
set -eu
[ "$1" = prepared ] || exit 0
zero=0000000000000000000000000000000000000000
integration=$(git rev-parse --verify refs/heads/develop)
while read -r old new ref; do
  case "$ref" in refs/heads/*) ;; *) continue ;; esac
  # Packing first persists the same object, then prunes the loose copy.
  # A real deletion of a packed branch also locks/rewrites packed-refs.
  if [ "$new" = "$zero" ] && [ "$old" != "$zero" ]; then
    packed=$(git rev-parse --git-path packed-refs)
    loose=$(git rev-parse --git-path "$ref")
    if [ -f "$loose" ] && [ -f "$packed" ] && [ ! -e "$packed.lock" ] &&
       [ "$(cat "$loose")" = "$old" ] && awk -v oid="$old" -v ref="$ref" '$1==oid && $2==ref { found=1 } END { exit !found }' "$packed"; then
      continue
    fi
  fi
  if [ "$old" = "$zero" ]; then
    old=$(git rev-parse --verify --quiet "$ref") || old=$zero
  fi
  [ "$old" != "$new" ] || continue
  case "$ref" in
    refs/heads/main)
      [ "$new" != "$zero" ] && [ "$(git show -s --format=%P "$new")" = "$old $integration" ] &&
        [ "$(git rev-parse "$new^{tree}")" = "$(git rev-parse "$integration^{tree}")" ] ||
        { echo 'main은 현재 develop의 검증된 트리만 병합합니다.' >&2; exit 1; } ;;
    refs/heads/develop)
      [ "$new" != "$zero" ] && git merge-base --is-ancestor "$old" "$new" ||
        { echo 'develop의 기존 이력을 보존하세요.' >&2; exit 1; } ;;
    refs/heads/*)
      if [ "$old" = "$zero" ]; then
        [ "$new" = "$integration" ] ||
          { echo '새 작업 브랜치는 develop에서 만드세요.' >&2; exit 1; }
      fi ;;
  esac
done
