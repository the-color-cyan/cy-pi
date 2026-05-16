#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_settings="${HOME}/.pi/agent/settings.json"
output_file="$repo_root/packages.cyan.json"

usage() {
	cat <<'EOF'
Usage: scripts/copy-packages.sh [source-settings.json] [packages-output.json]

Copies pi package sources from the local global pi settings into
packages.cyan.json, excluding cy-pi itself.

Defaults:
  source-settings.json: ~/.pi/agent/settings.json
  packages-output.json: ./packages.cyan.json
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
	usage
	exit 0
fi

if [ $# -gt 2 ]; then
	usage >&2
	exit 1
fi

if [ $# -ge 1 ]; then
	source_settings="$1"
fi

if [ $# -eq 2 ]; then
	output_file="$2"
fi

python3 - "$source_settings" "$output_file" "$repo_root" <<'PY'
import json
import os
import re
import sys
from pathlib import Path

settings_path = Path(os.path.expandvars(os.path.expanduser(sys.argv[1])))
output_path = Path(os.path.expandvars(os.path.expanduser(sys.argv[2])))
repo_root = Path(sys.argv[3]).resolve()

try:
    data = json.loads(settings_path.read_text())
except FileNotFoundError:
    raise SystemExit(f"error: source settings file not found: {settings_path}")
except json.JSONDecodeError as exc:
    raise SystemExit(f"error: invalid JSON in {settings_path}: {exc}")

entries = data.get("packages", []) if isinstance(data, dict) else []
if not isinstance(entries, list):
    entries = []


def source_for(entry):
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        source = entry.get("source")
        return source if isinstance(source, str) else None
    return None


def npm_name(source):
    rest = source[4:].strip()
    match = re.match(r"(@[^/]+/[^@]+|[^@]+)", rest)
    return match.group(1).lower() if match else ""


def strip_local_prefix(source):
    lowered = source.lower()
    for prefix in ("local:", "file:", "path:"):
        if lowered.startswith(prefix):
            return source[len(prefix):]
    if source.startswith(("/", "./", "../", "~")):
        return source
    return None


def is_repo_path(raw_path):
    expanded = Path(os.path.expandvars(os.path.expanduser(raw_path)))
    if not expanded.is_absolute():
        expanded = (settings_path.parent / expanded)
    try:
        resolved = expanded.resolve()
    except OSError:
        resolved = expanded.absolute()
    return resolved == repo_root or resolved.name == "cy-pi"


def is_cy_pi(source):
    lowered = source.strip().lower()
    if not lowered:
        return False

    if lowered.startswith("npm:"):
        name = npm_name(lowered)
        return name == "cy-pi" or name.endswith("/cy-pi")

    if lowered.startswith("git:") or "github.com" in lowered:
        without_ref = re.sub(r"(?<=[/:])cy-pi(?:\.git)?(?:[@#?].*)?$", "cy-pi", lowered)
        return (
            "the-color-cyan/cy-pi" in without_ref
            or re.search(r"(^|[:/])cy-pi(?:\.git)?(?:[@#?]|$)", lowered) is not None
        )

    local_path = strip_local_prefix(source.strip())
    return local_path is not None and is_repo_path(local_path)


def has_embedded_credentials(source):
    match = re.search(r"(?:^|:)([a-z][a-z0-9+.-]*://)([^/@\s]+)@", source, re.I)
    if not match:
        return False
    scheme = match.group(1).lower()
    userinfo = match.group(2)
    return not (scheme in {"ssh://", "git+ssh://"} and userinfo == "git")


def skip_reason(source):
    if has_embedded_credentials(source):
        return "credential-bearing URL"
    if strip_local_prefix(source) is not None:
        return "non-portable local path"
    return None

packages = []
seen = set()
skipped_cy_pi = 0
skipped_invalid = 0
skipped_non_portable = 0
for entry in entries:
    source = source_for(entry)
    if not source or not source.strip():
        skipped_invalid += 1
        continue
    source = source.strip()
    if is_cy_pi(source):
        skipped_cy_pi += 1
        continue
    reason = skip_reason(source)
    if reason:
        skipped_non_portable += 1
        display_source = "<redacted>" if reason == "credential-bearing URL" else source
        print(f"Skipping {reason}: {display_source}", file=sys.stderr)
        continue
    if source in seen:
        continue
    seen.add(source)
    packages.append(source)

output_path.parent.mkdir(parents=True, exist_ok=True)
output_path.write_text(json.dumps(packages, indent=2) + "\n")
print(f"Wrote {len(packages)} package source(s) to {output_path}")
if skipped_cy_pi:
    print(f"Skipped {skipped_cy_pi} cy-pi package source(s)")
if skipped_invalid:
    print(f"Skipped {skipped_invalid} package entr{'y' if skipped_invalid == 1 else 'ies'} without a source")
if skipped_non_portable:
    print(f"Skipped {skipped_non_portable} non-portable or credential-bearing package source(s)")
PY
