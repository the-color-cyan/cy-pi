#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export PI_CODING_AGENT_DIR="$repo_root"

pi_executable="$repo_root/bin/pi"
if [ ! -x "$pi_executable" ]; then
	printf 'Canonical Pi wrapper is missing: %s\nRun %s/scripts/init-agent-home.sh to restore it.\n' "$pi_executable" "$repo_root" >&2
	exit 1
fi

exec "$pi_executable" "$@"
