#!/bin/bash
set -euo pipefail
if [[ "${HERDR_ENV:-}" != 1 ]]; then
  echo "Run from a Herdr terminal." >&2
  exit 1
fi
herdr plugin enable tdi.worktree-from-linear
herdr plugin disable kakahn.worktree-from-linear
printf '%s\n' 'Original plugin re-enabled. Worktrees, panes and fork configuration preserved.'
