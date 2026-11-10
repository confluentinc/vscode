#!/usr/bin/env bash
# Whether the push that triggered this pipeline changed any of the given paths, judged only from
# $SEMAPHORE_GIT_COMMIT_RANGE. On a release branch `change_in` looks back to the merge-base with main,
# and the option that limited it to the push now fails PR pipelines (semaphoreci/spc#62).
#
# Usage: .semaphore/scripts/changed-in-push.sh <path>...   (repo-relative, no leading slash)
# Exit codes: 0 = a path changed in this push, 1 = none changed, 2 = can't tell (bad usage, or a
# commit in the range can't be fetched, as after a force-push), 3 = no range (a branch's first push).
set -uo pipefail

if [[ $# -eq 0 ]]; then
  echo "usage: $0 <path>..." >&2
  exit 2
fi

range="${SEMAPHORE_GIT_COMMIT_RANGE:-}"
if [[ -z "$range" ]]; then
  echo "No commit range for this push (first push of a branch?)" >&2
  exit 3
fi

# handles both `a...b` and `a..b`
before="${range%%..*}"
after="${range##*..}"
# git reports a new branch's missing "before" as all zeros
if [[ "$before" =~ ^0+$ ]]; then
  echo "No earlier commit in range $range (first push of a branch?)" >&2
  exit 3
fi
for sha in "$before" "$after"; do
  if ! git cat-file -e "${sha}^{commit}" 2>/dev/null &&
    ! git fetch -q --no-tags --depth=1 origin "$sha"; then
    echo "Can't fetch commit $sha from range $range" >&2
    exit 2
  fi
done

# compare the two trees directly, which needs no merge-base and so works in a shallow clone
git diff --quiet "$before" "$after" -- "$@"
case $? in
  0) exit 1 ;;
  1) exit 0 ;;
  *) exit 2 ;;
esac
