#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
zshrc="${PI_SHELL_RC:-$HOME/.zshrc}"
mode="${1:-}"

usage() {
  cat <<'EOF'
Usage: scripts/use-pi-mode.sh <dev|normal|status>

Modes:
  dev     Make `pi` use isolated cy-pi dev home (~/.pi-dev/agent)
  normal  Make `pi` use the default pi home (~/.pi/agent)
  status  Show the current managed shell mode

The script updates a marked block in ~/.zshrc. Open a new shell or run:
  source ~/.zshrc
EOF
}

start_marker="# >>> cy-pi pi mode >>>"
end_marker="# <<< cy-pi pi mode <<<"

current_mode() {
  if [ ! -f "$zshrc" ]; then
    echo "unconfigured"
    return
  fi
  local block
  block="$(awk "/$start_marker/{flag=1} flag; /$end_marker/{flag=0}" "$zshrc")"
  if printf '%s\n' "$block" | grep -q "cy-pi-mode: dev"; then
    echo "dev"
  elif printf '%s\n' "$block" | grep -q "cy-pi-mode: normal"; then
    echo "normal"
  else
    echo "unconfigured"
  fi
}

write_block() {
  local block="$1"
  touch "$zshrc"
  python3 - "$zshrc" "$start_marker" "$end_marker" "$block" <<'PY'
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

case "$mode" in
  dev)
    "$repo_root/scripts/setup-pi-dev-isolation.sh"
    block=$(cat <<EOF
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
)
    write_block "$block"
    echo "pi mode: dev. Restart shell or run: source $zshrc"
    ;;
  normal)
    block=$(cat <<EOF
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
)
    write_block "$block"
    echo "pi mode: normal. Restart shell or run: source $zshrc"
    ;;
  status)
    echo "pi mode: $(current_mode)"
    echo "shell rc: $zshrc"
    ;;
  -h|--help|help|"")
    usage
    ;;
  *)
    echo "Unknown mode: $mode" >&2
    usage >&2
    exit 1
    ;;
esac
