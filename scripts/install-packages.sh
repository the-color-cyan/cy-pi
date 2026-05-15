#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
packages_file="$repo_root/packages.example.json"

usage() {
	cat <<'EOF'
Usage: scripts/install-packages.sh [packages.json|settings.json]

Installs the pi package sources listed in packages.example.json into the local
global pi settings (~/.pi/agent/settings.json) via `pi install`.

Pass a different JSON file to install from that file. The input may be either a
top-level JSON array of package entries or a settings-style object with a
`packages` array.
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
	usage
	exit 0
fi

if [ $# -gt 1 ]; then
	usage >&2
	exit 1
fi

if [ $# -eq 1 ]; then
	packages_file="$1"
fi

if ! command -v pi >/dev/null 2>&1; then
	echo "error: pi is not on PATH" >&2
	exit 1
fi

packages_list="$(mktemp)"
trap 'rm -f "$packages_list"' EXIT

python3 - "$packages_file" >"$packages_list" <<'PY'
import json
import os
import sys
from pathlib import Path

path = Path(os.path.expandvars(os.path.expanduser(sys.argv[1])))
try:
    data = json.loads(path.read_text())
except FileNotFoundError:
    raise SystemExit(f"error: packages file not found: {path}")
except json.JSONDecodeError as exc:
    raise SystemExit(f"error: invalid JSON in {path}: {exc}")

entries = data if isinstance(data, list) else data.get("packages", []) if isinstance(data, dict) else []
for entry in entries or []:
    source = entry.get("source") if isinstance(entry, dict) else entry
    if isinstance(source, str) and source.strip():
        print(source.strip())
PY

if [ ! -s "$packages_list" ]; then
	echo "No packages found in $packages_file"
	exit 0
fi

while IFS= read -r package; do
	echo "Installing $package"
	pi install "$package"
done <"$packages_list"

echo "Done."
