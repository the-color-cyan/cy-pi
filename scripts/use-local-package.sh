#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
agent_dir="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
settings_path="$agent_dir/settings.json"

usage() {
  cat <<'EOF_USAGE'
Usage: scripts/use-local-package.sh

Replaces cy-pi package entries in pi settings with a local path to this checkout,
then links only non-package resources (agents, global prompts) via
scripts/install-local-links.sh --no-package-resources.

This avoids duplicate extension/skill conflicts when developing this repo locally.
EOF_USAGE
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

if [ $# -gt 0 ]; then
  echo "Unknown argument: $1" >&2
  usage >&2
  exit 1
fi

mkdir -p "$agent_dir"
if [ ! -f "$settings_path" ]; then
  echo '{}' > "$settings_path"
fi

python3 - "$repo_root" "$settings_path" <<'PY'
import json
import pathlib
import sys

repo = pathlib.Path(sys.argv[1]).resolve()
settings = pathlib.Path(sys.argv[2])

try:
    data = json.loads(settings.read_text())
    if not isinstance(data, dict):
        data = {}
except Exception:
    data = {}

packages = data.get("packages", []) or []
if not isinstance(packages, list):
    packages = []


def source_of(entry):
    return entry.get("source") if isinstance(entry, dict) else entry


def is_cy_pi_source(source: str) -> bool:
    lower = source.lower().rstrip("/")
    normalized = lower.replace(":", "/")
    if normalized.endswith(".git"):
        normalized = normalized[:-4]

    # Remote package specs, e.g. git:github.com/the-color-cyan/cy-pi or git@github.com:...
    if "github.com/the-color-cyan/cy-pi" in normalized:
        return True

    # Local paths pointing at this checkout.
    if source.startswith(("/", "./", "../")):
        try:
            resolved = pathlib.Path(source)
            if not resolved.is_absolute():
                resolved = settings.parent / resolved
            resolved = resolved.resolve()
            if resolved == repo:
                return True
            # Package-cache path references sometimes appear as absolute paths.
            parts = set(resolved.parts)
            if resolved.name == "cy-pi" and ".pi" in parts and "git" in parts:
                return True
        except Exception:
            pass

    # Defensive fallback for shorthand package specs ending in /cy-pi.
    return normalized.endswith("/cy-pi") or normalized in {"cy-pi", "npm/cy-pi", "npm/cy-pi@latest"}

cleaned = []
removed = []
for entry in packages:
    source = source_of(entry)
    if isinstance(source, str) and is_cy_pi_source(source):
        removed.append(source)
        continue
    cleaned.append(entry)

repo_entry = str(repo)
if repo_entry not in [source_of(entry) for entry in cleaned]:
    cleaned.append(repo_entry)

data["packages"] = cleaned
settings.write_text(json.dumps(data, indent=2) + "\n")

print(f"Updated pi settings: {settings}")
if removed:
    print("Removed cy-pi package refs:")
    for source in removed:
        print(f"  - {source}")
print(f"Added local package: {repo}")
PY

"$repo_root/scripts/install-local-links.sh" --no-package-resources

cat <<EOF_NEXT

Next steps:
1. Run '/reload' in pi or restart pi to pick up the local package.
2. Keep using scripts/install-local-links.sh without package-resource forcing for non-package resources.
3. When done with local checkout development, replace the local package entry in $settings_path with a pinned git/npm package if desired.
EOF_NEXT
