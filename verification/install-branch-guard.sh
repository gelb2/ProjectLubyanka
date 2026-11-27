#!/usr/bin/env bash
set -euo pipefail
root=$(git rev-parse --show-toplevel)
cd "$root"
target=$(git rev-parse --absolute-git-dir)/lubyanka-release-hooks
previous=$(git rev-parse --path-format=absolute --git-path hooks)
mkdir -p "$target"
if [[ "$previous" != "$target" ]]; then
  ln -sfn "$previous" "$target/previous"
fi
for hook in "$target"/previous/*; do
  [[ -f "$hook" && -x "$hook" ]] || continue
  name=${hook##*/}
  [[ "$name" != reference-transaction && "$name" != *.sample ]] || continue
  ln -sfn "previous/$name" "$target/$name"
done
cp "$root/verification/branch-guard.sh" "$target/branch-guard"
cat > "$target/reference-transaction" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail
dir=$(dirname "$0")
if [[ -x "$dir/previous/reference-transaction" ]]; then
  input=$(mktemp)
  trap 'rm -f "$input"' EXIT
  cat > "$input"
  "$dir/branch-guard" "$@" < "$input"
  "$dir/previous/reference-transaction" "$@" < "$input"
else
  exec "$dir/branch-guard" "$@"
fi
HOOK
chmod +x "$target/reference-transaction"
git config --local core.hooksPath "$target"
