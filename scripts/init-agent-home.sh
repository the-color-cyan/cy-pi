#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
package_dir="$repo_root/npm"

log() {
	printf '%s\n' "$*"
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
	local node_bin_path="$repo_root/node_modules/.bin"
	local posix_start="# >>> cy-pi agent-home PATH >>>"
	local posix_end="# <<< cy-pi agent-home PATH <<<"
	local fish_start="# >>> cy-pi agent-home PATH >>>"
	local fish_end="# <<< cy-pi agent-home PATH <<<"
	local posix_block
	local fish_block

	posix_block="$(
		cat <<EOF
$posix_start
cy_pi_bin="$shell_bin_path"
cy_pi_old_node_bin="$node_bin_path"
cy_pi_clean_path=""
cy_pi_old_ifs="\$IFS"
IFS=:
for cy_pi_path in \$PATH; do
	if [ -n "\$cy_pi_path" ] && [ "\$cy_pi_path" != "\$cy_pi_bin" ] && [ "\$cy_pi_path" != "\$cy_pi_old_node_bin" ]; then
		cy_pi_clean_path="\${cy_pi_clean_path:+\$cy_pi_clean_path:}\$cy_pi_path"
	fi
done
IFS="\$cy_pi_old_ifs"
export PATH="\$cy_pi_bin\${cy_pi_clean_path:+:\$cy_pi_clean_path}"
unset cy_pi_bin cy_pi_old_node_bin cy_pi_clean_path cy_pi_old_ifs cy_pi_path
$posix_end
EOF
	)"
	fish_block="$(
		cat <<EOF
$fish_start
set -l cy_pi_bin "$shell_bin_path"
set -l cy_pi_old_node_bin "$node_bin_path"
set -l cy_pi_clean_user_paths
if set -q fish_user_paths
	for cy_pi_path in \$fish_user_paths
		if test -n "\$cy_pi_path"; and test "\$cy_pi_path" != "\$cy_pi_bin"; and test "\$cy_pi_path" != "\$cy_pi_old_node_bin"
			set -a cy_pi_clean_user_paths "\$cy_pi_path"
		end
	end
end
set -U fish_user_paths "\$cy_pi_bin" \$cy_pi_clean_user_paths

set -l cy_pi_clean_path
for cy_pi_path in \$PATH
	if test -n "\$cy_pi_path"; and test "\$cy_pi_path" != "\$cy_pi_bin"; and test "\$cy_pi_path" != "\$cy_pi_old_node_bin"
		set -a cy_pi_clean_path "\$cy_pi_path"
	end
end
set -gx PATH "\$cy_pi_bin" \$cy_pi_clean_path
set -e cy_pi_bin cy_pi_old_node_bin cy_pi_clean_user_paths cy_pi_clean_path cy_pi_path
$fish_end
EOF
	)"

	write_managed_block "${HOME:?HOME is required}/.zshrc" "$posix_start" "$posix_end" "$posix_block"
	write_managed_block "$HOME/.bashrc" "$posix_start" "$posix_end" "$posix_block"
	write_managed_block "$HOME/.bash_profile" "$posix_start" "$posix_end" "$posix_block"
	write_managed_block "$HOME/.config/fish/conf.d/cy-pi.fish" "$fish_start" "$fish_end" "$fish_block"
	log "Configured shell PATH for bash, zsh, and fish"
}

install_package_dependencies() {
	local dir="$1"

	if [ ! -f "$dir/package.json" ]; then
		return
	fi
	if [ ! -f "$dir/package-lock.json" ]; then
		log "Missing required package lock: $dir/package-lock.json"
		return 1
	fi

	(
		cd "$dir"
		npm ci
	)
}

setup_agent_home_pi_wrapper() {
	local wrapper_path="$repo_root/bin/pi"
	local local_pi="$repo_root/node_modules/.bin/pi"

	if [ ! -x "$local_pi" ]; then
		log "Canonical Pi runtime is missing after npm ci: $local_pi"
		return 1
	fi

	cat >"$wrapper_path" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
local_pi="${repo_root}/node_modules/.bin/pi"
agent_home_update_script="${repo_root}/scripts/update-agent-home.sh"
runtime_update_script="${repo_root}/scripts/update-pi-runtime.sh"
export PI_CODING_AGENT_DIR="$repo_root"

if [[ ! -x "$local_pi" ]]; then
	printf 'Canonical Pi runtime is missing: %s\nRun %s/scripts/init-agent-home.sh to restore it.\n' "$local_pi" "$repo_root" >&2
	exit 1
fi

if [[ "${1:-}" == "update" ]]; then
	bash "$agent_home_update_script" --pull
	shift
	case "${1:-}" in
	"" | self | pi | --self)
		exec bash "$runtime_update_script"
		;;
	--all)
		bash "$runtime_update_script"
		exec "$local_pi" update --extensions
		;;
	*)
		exec "$local_pi" update "$@"
		;;
	esac
fi

exec "$local_pi" "$@"
EOF

	chmod +x "$wrapper_path"
	log "Created repo-pinned Pi wrapper at $wrapper_path"
}

if ! command -v npm >/dev/null 2>&1; then
	log "npm is required to install the repo-pinned Pi runtime."
	exit 1
fi

mkdir -p \
	"$repo_root/sessions" \
	"$repo_root/sessions/subagent" \
	"$repo_root/git" \
	"$repo_root/bin" \
	"$repo_root/github-tracker-runs" \
	"$repo_root/logs"

bash "$repo_root/scripts/reconcile-settings.sh" --repo "$repo_root"

install_package_dependencies "$repo_root"
install_package_dependencies "$package_dir"
setup_agent_home_pi_wrapper
setup_shell_path

cat <<EOF

This checkout is ready to use as the canonical Pi agent home and runtime:

  pi

or:

  "$repo_root/scripts/pi-home.sh"

The exact Pi runtime is pinned by package.json and package-lock.json. Runtime state created here is ignored by git; auth.json is not copied or synchronized.

Reference setup applied:

  - runtime directories exist under this checkout
  - settings.json was reconciled from settings.managed.json while preserving undeclared local keys
  - declarative settings paths were materialized for this checkout
  - locked root and npm/package.json dependencies were installed with npm ci
  - bin/pi runs the repo-pinned node_modules/.bin/pi and sets PI_CODING_AGENT_DIR
  - bash, zsh, and fish startup files put only "$repo_root/bin" first on PATH
  - stale "$repo_root/node_modules/.bin" PATH entries are removed by the managed shell block
  - \`pi update\` pulls agent-home changes and updates the tracked runtime pin
  - commit and push package.json/package-lock.json changes after a runtime update to synchronize other machines
  - restart your shell or run \`exec \$SHELL\`; for fish, \`exec fish\` is also fine
EOF
