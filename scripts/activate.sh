#!/bin/bash
set -euo pipefail
if [[ "${HERDR_ENV:-}" != 1 ]]; then
  echo "Run this script from a Herdr terminal. No changes made." >&2
  exit 1
fi
plugin_root="$(cd "$(dirname "$0")/.." && pwd)"
config_file="${HERDR_CONFIG_PATH:-$HOME/.config/herdr/config.toml}"
config_root="$(dirname "$config_file")"
node "$plugin_root/scripts/migrate-config.js" "$config_root"
herdr plugin link "$plugin_root" --enabled
herdr plugin disable tdi.worktree-from-linear
printf '%s\n' 'Fork activated. In the palette: Worktree from Linear issue.' 'The original plugin is preserved but disabled.'
