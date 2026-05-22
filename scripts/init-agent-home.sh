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

setup_agent_home_pi_wrapper() {
	local wrapper_path="$repo_root/bin/pi"
	local wrapper_content_dir="$(dirname "$wrapper_path")"
	local real_pi

	real_pi="${CY_PI_REAL_PI_COMMAND:-$(command -v pi || true)}"
	if [ -z "$real_pi" ]; then
		log "Warning: could not locate system pi executable. Skipping pi update wrapper generation."
		return
	fi

	if [ "$real_pi" = "$wrapper_path" ]; then
		local wrapper_free_path=""
		local clean_path=""
		local path_entry
		local -a path_entries
		IFS=':' read -r -a path_entries <<<"$PATH"
		for path_entry in "${path_entries[@]}"; do
			if [ -z "$path_entry" ] || [ "$path_entry" = "$wrapper_content_dir" ]; then
				continue
			fi
			clean_path="${clean_path:+$clean_path:}$path_entry"
		done
		wrapper_free_path="$(PATH="$clean_path" command -v pi 2>/dev/null || true)"
		if [ -n "$wrapper_free_path" ]; then
			real_pi="$wrapper_free_path"
		else
			log "Warning: existing pi command resolves to this repository wrapper. Skipping wrapper generation."
			return
		fi
	fi

	cat >"$wrapper_path" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
update_script="${repo_root}/scripts/update-agent-home.sh"

if [[ "${1:-}" == "update" ]]; then
	bash "${update_script}" --pull
fi

exec __CY_PI_REAL_PI__ "$@"
EOF
	python3 - "$wrapper_path" "$real_pi" <<'PY'
from pathlib import Path
import shlex
import sys

path = Path(sys.argv[1])
real_pi = shlex.quote(sys.argv[2])
path.write_text(path.read_text().replace("__CY_PI_REAL_PI__", real_pi))
PY

	chmod +x "$wrapper_path"
	log "Created pi update wrapper at $wrapper_path"
}

setup_agent_home_pi_wrapper
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
  - update wrapper is configured at bin/pi to run a safe agent-home pull on \`pi update\`
  - pi-home.sh uses bin/pi automatically; put "$repo_root/bin" first on PATH for plain \`pi update\`
  - startup update checker is available via the \`agent-home-update.ts\` extension
EOF
