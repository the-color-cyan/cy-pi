#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="${1:-}"

# Override with PI_SHELL_RC=/path/to/rc to update one file only (useful for tests).
declare -a rc_specs
if [ -n "${PI_SHELL_RC:-}" ]; then
	rc_specs=("bash:$PI_SHELL_RC")
else
	rc_specs=(
		"bash:$HOME/.bashrc"
		"zsh:$HOME/.zshrc"
		"fish:$HOME/.config/fish/config.fish"
	)
fi

usage() {
	cat <<'EOF'
Usage: scripts/use-pi-mode.sh <dev|normal|status>

Modes:
  dev     Make `pi` use isolated cy-pi dev home (~/.pi-dev/agent) in bash/zsh;
          fish keeps default `pi` and adds `pi-dev`
  normal  Make `pi` use the default pi home (~/.pi/agent)
  status  Show the current managed shell mode for bash, zsh, and fish

By default this updates:
  ~/.bashrc
  ~/.zshrc
  ~/.config/fish/config.fish

Open a new shell after switching, or source the relevant rc file.
For tests/one-off edits, set PI_SHELL_RC=/path/to/rc.
EOF
}

start_marker="# >>> cy-pi pi mode >>>"
end_marker="# <<< cy-pi pi mode <<<"

rc_shell() { printf '%s' "${1%%:*}"; }
rc_path() { printf '%s' "${1#*:}"; }

block_for() {
	local shell="$1"
	local target_mode="$2"

	case "$shell:$target_mode" in
	fish:dev)
		cat <<EOF
$start_marker
# Managed by $repo_root/scripts/use-pi-mode.sh
# cy-pi-mode: dev
# Fish keeps default pi unchanged. Use pi-dev for isolated cy-pi development.
function pi-dev
  set -lx PI_CODING_AGENT_DIR "\$HOME/.pi-dev/agent"
  command pi \$argv
end
$end_marker
EOF
		;;
	fish:normal)
		cat <<EOF
$start_marker
# Managed by $repo_root/scripts/use-pi-mode.sh
# cy-pi-mode: normal
# Normal/default harness. Isolated cy-pi development harness is pi-dev.
function pi
  command pi \$argv
end

function pi-dev
  set -lx PI_CODING_AGENT_DIR "\$HOME/.pi-dev/agent"
  command pi \$argv
end
$end_marker
EOF
		;;
	*:dev)
		cat <<EOF
$start_marker
# Managed by $repo_root/scripts/use-pi-mode.sh
# cy-pi-mode: dev
# Isolated cy-pi development harness. Normal/default harness is pi-normal.
pi() {
  PI_CODING_AGENT_DIR="\$HOME/.pi-dev/agent" command pi "\$@"
}

pi-normal() {
  command pi "\$@"
}
$end_marker
EOF
		;;
	*:normal)
		cat <<EOF
$start_marker
# Managed by $repo_root/scripts/use-pi-mode.sh
# cy-pi-mode: normal
# Normal/default harness. Isolated cy-pi development harness is pi-dev.
pi() {
  command pi "\$@"
}

pi-dev() {
  PI_CODING_AGENT_DIR="\$HOME/.pi-dev/agent" command pi "\$@"
}
$end_marker
EOF
		;;
	*)
		echo "unsupported shell/mode: $shell/$target_mode" >&2
		return 1
		;;
	esac
}

current_mode_for_path() {
	local path="$1"
	if [ ! -f "$path" ]; then
		echo "unconfigured"
		return
	fi
	local block
	block="$(awk "/$start_marker/{flag=1} flag; /$end_marker/{flag=0}" "$path")"
	if printf '%s\n' "$block" | grep -q "cy-pi-mode: dev"; then
		echo "dev"
	elif printf '%s\n' "$block" | grep -q "cy-pi-mode: normal"; then
		echo "normal"
	else
		echo "unconfigured"
	fi
}

write_block() {
	local path="$1"
	local block="$2"
	mkdir -p "$(dirname "$path")"
	touch "$path"
	python3 - "$path" "$start_marker" "$end_marker" "$block" <<'PY'
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
start = sys.argv[2]
end = sys.argv[3]
block = sys.argv[4]
text = path.read_text()

if start in text and end in text:
    before = text.split(start, 1)[0].rstrip()
    after = text.split(end, 1)[1].lstrip("\n")
    new = before + "\n\n" + block.rstrip() + "\n"
    if after:
        new += "\n" + after
else:
    new = text.rstrip() + "\n\n" + block.rstrip() + "\n"

path.write_text(new)
PY
}

set_mode() {
	local target_mode="$1"
	local spec shell path block
	for spec in "${rc_specs[@]}"; do
		shell="$(rc_shell "$spec")"
		path="$(rc_path "$spec")"
		block="$(block_for "$shell" "$target_mode")"
		write_block "$path" "$block"
		echo "updated $path ($shell): $target_mode"
	done
}

show_status() {
	local spec shell path
	for spec in "${rc_specs[@]}"; do
		shell="$(rc_shell "$spec")"
		path="$(rc_path "$spec")"
		echo "$shell: $(current_mode_for_path "$path") ($path)"
	done
}

case "$mode" in
dev)
	"$repo_root/scripts/setup-pi-dev-isolation.sh"
	set_mode dev
	echo "pi mode: dev. Open a new shell or source the relevant rc file."
	;;
normal)
	set_mode normal
	echo "pi mode: normal. Open a new shell or source the relevant rc file."
	;;
status)
	show_status
	;;
-h | --help | help | "")
	usage
	;;
*)
	echo "Unknown mode: $mode" >&2
	usage >&2
	exit 1
	;;
esac
