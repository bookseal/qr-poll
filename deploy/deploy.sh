#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '%s\n' "$*" >&2
  exit 1
}

target=${1:-}
mode=${2:-}
[[ $target =~ ^[0-9a-f]{40}$ && ( -z $mode || $mode == --check ) && $# -le 2 ]] ||
  fail 'Usage: bash deploy/deploy.sh <full main SHA> [--check]'

cd "$(git rev-parse --show-toplevel)"
git_dir=$(git rev-parse --absolute-git-dir)
exec 9>"$git_dir/qr-poll-deploy.lock"
flock -n 9 || fail 'Another QR Poll deployment is in progress.'

git fetch -q origin refs/heads/main:refs/remotes/origin/main
git merge-base --is-ancestor "$target" origin/main || fail 'Commit is not on origin/main.'
tracked_changes=$(git status --porcelain --untracked-files=no)
[[ -z $tracked_changes ]] ||
  fail 'Tracked production files have local changes.'

ci_url="https://api.github.com/repos/bookseal/qr-poll/actions/workflows/ci.yml/runs"
curl -fsS --max-time 15 "$ci_url?branch=main&event=push&status=success&head_sha=$target&per_page=1" |
  node -e '
    const { workflow_runs } = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    if (!workflow_runs?.some(run =>
      run.head_sha === process.argv[1] && run.conclusion === "success" &&
      run.head_branch === "main" && run.event === "push"
    )) process.exit(1);
  ' "$target" || fail "No successful main CI run could be verified for $target."

previous=$(git rev-parse HEAD)
if [[ $mode == --check || $previous == "$target" ]]; then
  printf 'Current: %s\nVerified target: %s\n' "$previous" "$target"
  exit 0
fi

[[ -d node_modules && ! -L node_modules ]] || fail 'Missing production node_modules directory.'
sudo -v
sudo -l /usr/bin/systemctl restart qr-chat >/dev/null
stage=$(mktemp -d "$git_dir/qr-poll-deploy.XXXXXX")
restart_attempted=false

restart_and_check() {
  local origin=http://127.0.0.1:3000
  sudo /usr/bin/systemctl restart qr-chat &&
    curl -fsS --retry 5 --retry-connrefused --retry-delay 1 --max-time 5 "$origin/api/9587463" >/dev/null &&
    curl -fsS --max-time 5 "$origin/r/9587463" >/dev/null &&
    node - "$origin/stream/9587463" <<'JS'
(async () => {
  const response = await fetch(process.argv[2], { signal: AbortSignal.timeout(5000) });
  const assert = require("node:assert/strict");
  assert(response.ok);
  assert.match(response.headers.get("content-type"), /^text\/event-stream\b/);
  const reader = response.body.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  assert.match(Buffer.from(value).toString(), /^: connected\n\n/);
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
JS
}

restore_dependencies() {
  if [[ -e node_modules ]]; then
    mv node_modules "$stage/failed_modules" || return
  fi
  mv "$stage/previous_modules" node_modules
}

cleanup() {
  local result=$?
  trap - EXIT
  if (( result != 0 )) && [[ $(git rev-parse HEAD) != "$previous" ]]; then
    printf 'Deployment failed. Restoring %s.\n' "$previous" >&2
    if ! git switch --quiet --detach --no-overwrite-ignore "$previous" ||
      { [[ -d $stage/previous_modules ]] && ! restore_dependencies; } ||
      { $restart_attempted && ! restart_and_check; }; then
      fail "Rollback failed. Recovery files are in $stage."
    fi
  fi
  rm -rf -- "$stage"
  exit "$result"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Fetch dependencies before replacing the live checkout or its installed modules.
git archive "$target" package.json package-lock.json | tar -x -C "$stage"
(cd "$stage" && npm ci --omit=dev)
git switch --quiet --detach --no-overwrite-ignore "$target"
mv node_modules "$stage/previous_modules"
mv "$stage/node_modules" node_modules
restart_attempted=true
restart_and_check
printf 'Deployed %s.\n' "$target"
