#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
	cat <<'EOF'
Usage: reconcile-settings.sh [--repo <path>]

Recursively overlays settings.managed.json onto the ignored settings.json.
Keys not present in the declarative file are preserved; declared arrays replace
local arrays. $PI_CODING_AGENT_DIR placeholders are materialized to the repo path.
EOF
}

while [[ $# -gt 0 ]]; do
	case "$1" in
	--repo)
		shift
		repo_root="${1:?--repo requires an argument}"
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		printf 'Unknown argument: %s\n' "$1" >&2
		usage >&2
		exit 2
		;;
	esac
	shift
done

settings_src="$repo_root/settings.managed.json"
settings_dst="$repo_root/settings.json"

python3 - "$settings_src" "$settings_dst" "$repo_root" <<'PY'
from pathlib import Path
import json
import os
import stat
import sys
import tempfile

source_path = Path(sys.argv[1])
destination_path = Path(sys.argv[2])
repo_root = sys.argv[3]


def read_object(path: Path, *, required: bool) -> dict:
    if not path.exists():
        if required:
            raise SystemExit(f"Declarative settings file is missing: {path}")
        return {}
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"Cannot read valid JSON settings from {path}: {error}")
    if not isinstance(value, dict):
        raise SystemExit(f"Settings root must be a JSON object: {path}")
    return value


def materialize(value):
    if isinstance(value, dict):
        return {key: materialize(child) for key, child in value.items()}
    if isinstance(value, list):
        return [materialize(child) for child in value]
    if isinstance(value, str):
        return value.replace("$PI_CODING_AGENT_DIR", repo_root)
    return value


def overlay(local, declared):
    if isinstance(local, dict) and isinstance(declared, dict):
        merged = dict(local)
        for key, value in declared.items():
            merged[key] = overlay(local.get(key), value) if key in local else value
        return merged
    return declared


declared = materialize(read_object(source_path, required=True))
local = read_object(destination_path, required=False)
reconciled = overlay(local, declared)
rendered = json.dumps(reconciled, indent=2, ensure_ascii=False) + "\n"

# Validate both inputs before replacing the runtime file, then use an atomic rename
# so an interrupted reconciliation cannot leave partial JSON behind.
destination_path.parent.mkdir(parents=True, exist_ok=True)
mode = stat.S_IMODE(destination_path.stat().st_mode) if destination_path.exists() else 0o600
fd, temporary_name = tempfile.mkstemp(
    prefix=f".{destination_path.name}.", dir=destination_path.parent
)
try:
    with os.fdopen(fd, "w") as temporary:
        temporary.write(rendered)
    os.chmod(temporary_name, mode)
    os.replace(temporary_name, destination_path)
except BaseException:
    try:
        os.unlink(temporary_name)
    except FileNotFoundError:
        pass
    raise
PY

printf 'Reconciled %s from %s\n' "$settings_dst" "$settings_src"
