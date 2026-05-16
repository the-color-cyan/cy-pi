#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
packages_file="$repo_root/packages.cyan.json"
settings_file="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/settings.json"
prune=false

usage() {
	cat <<'EOF'
Usage: scripts/install-packages.sh [--prune] [packages.json|settings.json]

Installs the pi package sources listed in packages.cyan.json into the local
global pi settings (~/.pi/agent/settings.json) via `pi install`.

Pass a different JSON file to install from that file. The input may be either a
top-level JSON array of package entries or a settings-style object with a
`packages` array.

Options:
  --prune    Before installing, remove package entries from the target pi
             settings.json unless their source appears in the input file. This
             makes the local pi package list match the input exactly after the
             installs complete.
EOF
}

while [ $# -gt 0 ]; do
	case "$1" in
	-h | --help)
		usage
		exit 0
		;;
	--prune)
		prune=true
		shift
		;;
	--)
		shift
		break
		;;
	-*)
		usage >&2
		exit 1
		;;
	*)
		if [ "$packages_file" != "$repo_root/packages.cyan.json" ]; then
			usage >&2
			exit 1
		fi
		packages_file="$1"
		shift
		;;
	esac
done

if [ $# -gt 0 ]; then
	if [ "$packages_file" != "$repo_root/packages.cyan.json" ] || [ $# -gt 1 ]; then
		usage >&2
		exit 1
	fi
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

if [ "$prune" = true ]; then
	python3 - "$settings_file" "$packages_list" <<'PY'
import json
import os
import sys
from pathlib import Path

settings_path = Path(os.path.expandvars(os.path.expanduser(sys.argv[1])))
packages_list_path = Path(sys.argv[2])

desired = []
seen_desired = set()
for line in packages_list_path.read_text().splitlines():
    source = line.strip()
    if source and source not in seen_desired:
        desired.append(source)
        seen_desired.add(source)

try:
    data = json.loads(settings_path.read_text())
except FileNotFoundError:
    data = {}
except json.JSONDecodeError as exc:
    raise SystemExit(f"error: invalid JSON in {settings_path}: {exc}")

if not isinstance(data, dict):
    raise SystemExit(f"error: settings file must be a JSON object: {settings_path}")

entries = data.get("packages", [])
if not isinstance(entries, list):
    entries = []


def source_for(entry):
    if isinstance(entry, str):
        return entry.strip()
    if isinstance(entry, dict):
        source = entry.get("source")
        return source.strip() if isinstance(source, str) else None
    return None

kept = []
kept_sources = set()
removed = 0
for entry in entries:
    source = source_for(entry)
    if source in seen_desired and source not in kept_sources:
        kept.append(entry)
        kept_sources.add(source)
    else:
        removed += 1

data["packages"] = kept
settings_path.parent.mkdir(parents=True, exist_ok=True)
settings_path.write_text(json.dumps(data, indent=2) + "\n")
print(f"Pruned {removed} package entr{'y' if removed == 1 else 'ies'} from {settings_path}")
PY
fi

while IFS= read -r package; do
	echo "Installing $package"
	pi install "$package"
done <"$packages_list"

echo "Done."
