#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
settings_src="$repo_root/settings.example.json"
settings_dst="$repo_root/settings.json"
package_dir="$repo_root/npm"

log() {
	printf '%s\n' "$*"
}

json_escape() {
	python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$1"
}

materialize_settings() {
	local dst="$1"
	local escaped_root
	escaped_root="$(json_escape "$repo_root")"
	python3 - "$dst" "$escaped_root" <<'PY'
from pathlib import Path
import json
import sys

path = Path(sys.argv[1])
repo_root_json = sys.argv[2]
repo_root = json.loads(repo_root_json)
text = path.read_text()
text = text.replace('$PI_CODING_AGENT_DIR', repo_root)
path.write_text(text)
PY
}

mkdir -p \
	"$repo_root/sessions" \
	"$repo_root/sessions/subagent" \
	"$repo_root/git" \
	"$repo_root/bin" \
	"$repo_root/github-tracker-runs" \
	"$repo_root/logs"

if [ ! -f "$settings_dst" ]; then
	if [ -f "$settings_src" ]; then
		cp "$settings_src" "$settings_dst"
		materialize_settings "$settings_dst"
		log "Created $settings_dst from settings.example.json"
	else
		printf '{}\n' >"$settings_dst"
		log "Created empty $settings_dst"
	fi
else
	log "Keeping existing $settings_dst"
fi

if [ -f "$package_dir/package-lock.json" ]; then
	if command -v npm >/dev/null 2>&1; then
		(
			cd "$package_dir"
			npm ci
		)
	else
		log "npm was not found; skipping package install for $package_dir"
	fi
fi

cat <<EOF

This checkout is ready to use as a Pi agent home:

  PI_CODING_AGENT_DIR="$repo_root" pi

or:

  "$repo_root/scripts/pi-home.sh"

Runtime state created here is ignored by git. auth.json is not copied; sign in or copy it manually only if you intend to keep this checkout as your live agent home.

Reference setup applied:

  - runtime directories exist under this checkout
  - settings.json was created from settings.example.json when missing
  - settings paths were materialized for this checkout
  - package dependencies in npm/package-lock.json were installed when npm is available
EOF
