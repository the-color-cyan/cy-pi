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

managed_shell_path() {
	local bin_path="$repo_root/bin"
	if [[ -n "${HOME:-}" && "$bin_path" == "$HOME"/* ]]; then
		printf '$HOME/%s' "${bin_path#"$HOME"/}"
	else
		printf '%s' "$bin_path"
	fi
}

write_managed_block() {
	local path="$1"
	local start_marker="$2"
	local end_marker="$3"
	local block="$4"
	mkdir -p "$(dirname "$path")"
	python3 - "$path" "$start_marker" "$end_marker" "$block" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
start = sys.argv[2]
end = sys.argv[3]
block = sys.argv[4].rstrip() + "\n"
text = path.read_text() if path.exists() else ""
start_index = text.find(start)
if start_index != -1:
    end_index = text.find(end, start_index)
    if end_index != -1:
        end_index = text.find("\n", end_index)
        if end_index == -1:
            text = text[:start_index] + block
        else:
            text = text[:start_index] + block + text[end_index + 1:]
    else:
        text = text.rstrip() + "\n" + block
else:
    separator = "" if not text or text.endswith("\n") else "\n"
    text = text + separator + block
path.write_text(text)
PY
}

setup_shell_path() {
	local shell_bin_path
	shell_bin_path="$(managed_shell_path)"
	local posix_start="# >>> cy-pi agent-home PATH >>>"
	local posix_end="# <<< cy-pi agent-home PATH <<<"
	local fish_start="# >>> cy-pi agent-home PATH >>>"
	local fish_end="# <<< cy-pi agent-home PATH <<<"
	local posix_block
	local fish_block

	posix_block="$(
		cat <<EOF
$posix_start
if [ -d "$shell_bin_path" ]; then
	case ":\$PATH:" in
		*":$shell_bin_path:"*) ;;
		*) export PATH="$shell_bin_path:\$PATH" ;;
	esac
fi
$posix_end
EOF
	)"
	fish_block="$(
		cat <<EOF
$fish_start
if test -d "$shell_bin_path"
	fish_add_path --prepend "$shell_bin_path"
end
$fish_end
EOF
	)"

	write_managed_block "${HOME:?HOME is required}/.zshrc" "$posix_start" "$posix_end" "$posix_block"
	write_managed_block "$HOME/.bashrc" "$posix_start" "$posix_end" "$posix_block"
	write_managed_block "$HOME/.bash_profile" "$posix_start" "$posix_end" "$posix_block"
	write_managed_block "$HOME/.config/fish/conf.d/cy-pi.fish" "$fish_start" "$fish_end" "$fish_block"
	log "Configured shell PATH for bash, zsh, and fish"
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
setup_shell_path
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

install_package_dependencies() {
	if ! command -v npm >/dev/null 2>&1; then
		log "npm was not found; skipping package install for $package_dir"
		return
	fi

	if [ ! -f "$package_dir/package.json" ]; then
		return
	fi

	(
		cd "$package_dir"
		if [ -f package-lock.json ]; then
			if npm ci; then
				return
			fi
			log "npm ci failed for $package_dir; refreshing package-lock.json with npm install"
		fi
		npm install
	)
}

install_package_dependencies

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
  - package dependencies in npm/package.json were installed when npm is available
  - update wrapper is configured at bin/pi to run a safe agent-home pull on \`pi update\`
  - bash, zsh, and fish startup files were configured to put "$repo_root/bin" first on PATH
  - restart your shell or run \`exec \$SHELL\`; for fish, \`exec fish\` is also fine
  - startup update checker is available via the \`agent-home-update.ts\` extension
EOF
