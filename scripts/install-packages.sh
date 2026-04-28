#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
settings_file="$repo_root/settings.example.json"

usage() {
  cat <<'EOF'
Usage: scripts/install-packages.sh [settings.json]

Installs the non-custom pi packages listed in settings.example.json into the
local global pi settings (~/.pi/agent/settings.json) via `pi install`.

Pass a different settings JSON file to install packages from that file.
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
  settings_file="$1"
fi

if ! command -v pi >/dev/null 2>&1; then
  echo "error: pi is not on PATH" >&2
  exit 1
fi

if [ ! -f "$settings_file" ]; then
  echo "error: settings file not found: $settings_file" >&2
  exit 1
fi

mapfile -t packages < <(python3 - "$settings_file" <<'PY'
import json, sys
from pathlib import Path

settings = Path(sys.argv[1])
data = json.loads(settings.read_text())
for entry in data.get("packages", []) or []:
    source = entry.get("source") if isinstance(entry, dict) else entry
    if isinstance(source, str) and source:
        print(source)
PY
)

if [ ${#packages[@]} -eq 0 ]; then
  echo "No packages found in $settings_file"
  exit 0
fi

for package in "${packages[@]}"; do
  echo "Installing $package"
  pi install "$package"
done

echo "Done."
