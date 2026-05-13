#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dev_agent_dir="${PI_DEV_AGENT_DIR:-$HOME/.pi-dev/agent}"
source_agent_dir="${PI_SOURCE_AGENT_DIR:-$HOME/.pi/agent}"
timestamp="$(date +%Y%m%d%H%M%S)"

backup_if_needed() {
	local dest="$1"
	local src="$2"

	if [ ! -e "$dest" ] && [ ! -L "$dest" ]; then
		return 0
	fi

	if [ -L "$dest" ]; then
		local current
		current="$(readlink "$dest")"
		if [ "$current" = "$src" ]; then
			return 0
		fi
	fi

	mv "$dest" "$dest.backup.$timestamp"
}

link_one() {
	local src="$1"
	local dest="$2"
	mkdir -p "$(dirname "$dest")"
	backup_if_needed "$dest" "$src"
	ln -sfn "$src" "$dest"
	echo "linked $dest -> $src"
}

remove_repo_link() {
	local dest="$1"
	if [ ! -L "$dest" ]; then
		return 0
	fi

	local current
	current="$(readlink "$dest")"
	case "$current" in
	"$repo_root"/*)
		rm "$dest"
		echo "removed repo link $dest"
		;;
	esac
}

link_dir_if_present() {
	local src="$1"
	local dest="$2"
	if [ -d "$src" ]; then
		link_one "$src" "$dest"
	else
		remove_repo_link "$dest"
		echo "skipped missing resource directory $src"
	fi
}

mkdir -p "$dev_agent_dir" "$dev_agent_dir/sessions"

if [ ! -e "$dev_agent_dir/auth.json" ] && [ -e "$source_agent_dir/auth.json" ]; then
	cp -p "$source_agent_dir/auth.json" "$dev_agent_dir/auth.json"
	chmod 600 "$dev_agent_dir/auth.json" || true
	echo "copied auth.json from $source_agent_dir"
fi

if [ ! -e "$dev_agent_dir/settings.json" ]; then
	if [ -e "$source_agent_dir/settings.json" ]; then
		cp -p "$source_agent_dir/settings.json" "$dev_agent_dir/settings.json"
		echo "copied settings.json from $source_agent_dir"
	else
		cp "$repo_root/settings.example.json" "$dev_agent_dir/settings.json"
		echo "created settings.json from settings.example.json"
	fi
fi

python3 - "$dev_agent_dir/settings.json" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
data = json.loads(path.read_text())

packages = data.get("packages")
if isinstance(packages, list):
    filtered = []
    for package in packages:
        source = package.get("source") if isinstance(package, dict) else package
        if isinstance(source, str) and "the-color-cyan/cy-pi" in source:
            continue
        if isinstance(source, str) and source.rstrip("/").endswith("/cy-pi"):
            continue
        filtered.append(package)
    data["packages"] = filtered

subagents = data.get("subagents")
if isinstance(subagents, dict):
    subagents["defaultSessionDir"] = "~/.pi-dev/agent/sessions/subagent"

path.write_text(json.dumps(data, indent=2) + "\n")
PY

echo "normalized $dev_agent_dir/settings.json"

# Custom cy-pi resources are linked into the isolated dev agent dir. Third-party
# packages/resources can remain in the normal ~/.pi tree or in dev settings.
link_dir_if_present "$repo_root/extensions" "$dev_agent_dir/extensions"
link_dir_if_present "$repo_root/skills" "$dev_agent_dir/skills"
link_dir_if_present "$repo_root/prompts" "$dev_agent_dir/prompts"
link_dir_if_present "$repo_root/themes" "$dev_agent_dir/themes"
link_dir_if_present "$repo_root/agents" "$dev_agent_dir/agents"
link_one "$repo_root/APPEND_SYSTEM.md" "$dev_agent_dir/APPEND_SYSTEM.md"
link_one "$repo_root/SUBAGENTS_ASYNC_PLAYBOOK.md" "$dev_agent_dir/SUBAGENTS_ASYNC_PLAYBOOK.md"
link_one "$repo_root/commit-message-prompt.md" "$dev_agent_dir/commit-message-prompt.md"

cat <<EOF

Done.
Run isolated dev pi with:
  PI_CODING_AGENT_DIR="$dev_agent_dir" pi

Recommended fish function:
  function pi-dev
    set -lx PI_CODING_AGENT_DIR "\$HOME/.pi-dev/agent"
    command pi \$argv
  end

For bash/zsh wrappers, or to install managed shell blocks, run:
  scripts/use-pi-mode.sh dev
EOF
